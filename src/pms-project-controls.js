'use strict';

const { calculateCpm } = require('./project-controls');

function text(value, label) {
  const result = String(value == null ? '' : value).trim();
  if (!result) throw new TypeError(label + ' is required');
  return result;
}
function number(value, label, fallback) {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new TypeError(label + ' is required');
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new TypeError(label + ' must be finite and non-negative');
  return result;
}
function date(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw + 'T00:00:00Z'))) {
    throw new TypeError('Dates must use YYYY-MM-DD');
  }
  return raw;
}
function dayDifference(later, earlier) {
  if (!later || !earlier) return null;
  return Math.round((Date.parse(later + 'T00:00:00Z') - Date.parse(earlier + 'T00:00:00Z')) / 86400000);
}
function isComplete(value) {
  return ['completed', 'complete', 'closed', 'achieved'].includes(String(value || '').trim().toLowerCase());
}
function weightedProgress(rows, field) {
  const weighted = rows.reduce((sum, row) => sum + number(row.Activity_Weight, 'Activity_Weight', 0), 0);
  if (weighted <= 0) return { available: false, value: null, reason: 'No positive Activity_Weight values are available' };
  const score = rows.reduce((sum, row) =>
    sum + number(row.Activity_Weight, 'Activity_Weight', 0) * number(row[field], field, 0), 0) / weighted;
  return { available: true, value: score, reason: null, totalWeight: weighted };
}

/**
 * Read-only adapter for the real PMS-VRY sheet record names.
 * Call only after the Apps Script API has authorized and project-scoped rows.
 */
function buildPmsProjectControlsReport(input) {
  if (!input || typeof input !== 'object') throw new TypeError('PMS project controls input is required');
  const project = input.project || {};
  const projectId = text(project.Project_ID, 'Project_ID');
  const statusDate = date(input.statusDate);
  if (!statusDate) throw new TypeError('statusDate is required');

  const activities = (input.activities || []).filter(row =>
    String(row.Project_ID || '').trim() === projectId && !['true', '1', 'yes'].includes(String(row.Is_Archived || '').trim().toLowerCase()));
  if (!activities.length) {
    return { projectId, statusDate, schedule: null, progress: { planned: null, actual: null }, finance: null,
      warnings: ['No active schedule activities are available'] };
  }
  const activityIds = new Set(activities.map(row => text(row.Activity_ID, 'Activity_ID')));
  if (activityIds.size !== activities.length) throw new Error('Duplicate Activity_ID values in project schedule');

  const dependencies = (input.dependencies || []).filter(row =>
    String(row.Project_ID || '').trim() === projectId &&
    !['false', '0', 'no', 'inactive'].includes(String(row.Is_Active == null ? 'true' : row.Is_Active).trim().toLowerCase()));
  const predecessors = new Map(activities.map(row => [String(row.Activity_ID), []]));
  dependencies.forEach(dep => {
    const predecessor = text(dep.Predecessor_ID, 'Predecessor_ID');
    const successor = text(dep.Successor_ID, 'Successor_ID');
    if (!activityIds.has(predecessor) || !activityIds.has(successor)) {
      throw new Error('Dependency references an activity outside the active project schedule');
    }
    const type = String(dep.Dependency_Type || 'FS').trim().toUpperCase();
    const lag = number(dep.Lag_Or_Lead_Days, 'Lag_Or_Lead_Days', 0);
    if (type !== 'FS' || lag !== 0) {
      throw new Error('CPM adapter currently supports Finish-to-Start dependencies with zero lag only');
    }
    predecessors.get(successor).push(predecessor);
  });

  // Legacy single-predecessor activity fields are honored only when no active
  // dependency-table row already represents that successor relationship.
  activities.forEach(row => {
    const id = String(row.Activity_ID);
    const legacy = String(row.Predecessor_ID || '').trim();
    if (legacy && predecessors.get(id).length === 0) {
      const type = String(row.Dependency_Type || 'FS').trim().toUpperCase();
      const lag = number(row.Lag_Or_Lead_Days, 'Lag_Or_Lead_Days', 0);
      if (type !== 'FS' || lag !== 0) throw new Error('CPM adapter currently supports Finish-to-Start dependencies with zero lag only');
      predecessors.get(id).push(legacy);
    }
  });

  const cpmInput = activities.map(row => ({
    id: String(row.Activity_ID),
    duration: number(row.Baseline_Duration, 'Baseline_Duration'),
    predecessors: predecessors.get(String(row.Activity_ID))
  }));
  const cpm = calculateCpm(cpmInput);
  const planned = weightedProgress(activities, 'Planned_Progress');
  const actual = weightedProgress(activities, 'Actual_Progress');

  const baseline = (input.baselines || [])
    .filter(row => String(row.Project_ID || '').trim() === projectId)
    .sort((a, b) => Number(b.Revision_Number || 0) - Number(a.Revision_Number || 0))[0] || null;
  let baselineSnapshot = null;
  if (baseline && baseline.Snapshot_JSON) {
    try { baselineSnapshot = JSON.parse(baseline.Snapshot_JSON); }
    catch (_) { throw new Error('Latest approved baseline Snapshot_JSON is invalid'); }
  }
  const baselineActivities = new Map(((baselineSnapshot && baselineSnapshot.activities) || [])
    .map(row => [String(row.Activity_ID || ''), row]));
  const baselineComparison = activities.map(row => {
    const saved = baselineActivities.get(String(row.Activity_ID));
    return {
      activityId: String(row.Activity_ID),
      baselineStart: date(saved && saved.Baseline_Start_Date),
      baselineFinish: date(saved && saved.Baseline_Finish_Date),
      currentBaselineStart: date(row.Baseline_Start_Date),
      currentBaselineFinish: date(row.Baseline_Finish_Date),
      forecastStart: date(row.Forecast_Start_Date),
      forecastFinish: date(row.Forecast_Finish_Date),
      actualStart: date(row.Actual_Start_Date),
      actualFinish: date(row.Actual_Finish_Date),
      baselineRevision: baseline ? Number(baseline.Revision_Number) || null : null,
      hasSnapshotMatch: Boolean(saved),
      finishVarianceDays: dayDifference(date(row.Actual_Finish_Date) || date(row.Forecast_Finish_Date), date(saved && saved.Baseline_Finish_Date) || date(row.Baseline_Finish_Date)),
      overdueAtStatusDate: !isComplete(row.Status) && Boolean(date(row.Forecast_Finish_Date)) && date(row.Forecast_Finish_Date) < statusDate
    };
  });

  const milestoneRows = (input.milestones || []).filter(row => String(row.Project_ID || '').trim() === projectId);
  const milestones = milestoneRows.map(row => {
    const forecastDate = date(row.Forecast_Date || row.Target_Date || row.Due_Date);
    const completed = isComplete(row.Milestone_Status);
    return {
      id: String(row.Milestone_ID || ''),
      name: String(row.Milestone_Name || ''),
      status: String(row.Milestone_Status || ''),
      forecastDate,
      overdueAtStatusDate: !completed && Boolean(forecastDate) && forecastDate < statusDate
    };
  });
  const delayedActivities = baselineComparison.filter(row => row.overdueAtStatusDate ||
    (row.finishVarianceDays != null && row.finishVarianceDays > 0));
  const delayedMilestones = milestones.filter(row => row.overdueAtStatusDate);

  const riskRows = (input.risks || []).filter(row =>
    String(row.Project_ID || '').trim() === projectId &&
    !['true', '1', 'yes'].includes(String(row.Is_Archived || '').trim().toLowerCase()));
  const risks = riskRows.map(row => {
    const status = String(row.Current_Status || row.Status || 'Open').trim();
    const rating = String(row.Risk_Rating || '').trim();
    const scoreMatch = rating.match(/^\\s*(\\d+(?:\\.\\d+)?)/);
    const score = scoreMatch ? Number(scoreMatch[1]) : null;
    const band = /critical/i.test(rating) || (score != null && score >= 15) ? 'critical'
      : /high/i.test(rating) || (score != null && score >= 10) ? 'high'
      : /medium/i.test(rating) || (score != null && score >= 5) ? 'medium' : 'unclassified';
    return { id: String(row.Risk_ID || ''), status, rating, score, band,
      isOpen: !['closed', 'resolved', 'accepted'].includes(status.toLowerCase()) };
  });
  const issueRows = (input.issues || []).filter(row =>
    String(row.Project_ID || '').trim() === projectId &&
    !['true', '1', 'yes'].includes(String(row.Is_Archived || '').trim().toLowerCase()));
  const issues = issueRows.map(row => {
    const status = String(row.Issue_Status || row.Status || 'Open').trim();
    return { id: String(row.Issue_ID || ''), status,
      isOpen: !['closed', 'resolved'].includes(status.toLowerCase()) };
  });
  const openRisks = risks.filter(row => row.isOpen);
  const criticalOpenRisks = openRisks.filter(row => row.band === 'critical' || row.band === 'high');
  const openIssues = issues.filter(row => row.isOpen);

  const financialRows = (input.financialItems || []).filter(row => String(row.Project_ID || '').trim() === projectId);
  const finance = financialRows.length ? financialRows.reduce((sum, row) => ({
    budget: sum.budget + number(row.Budget_Amount, 'Budget_Amount', 0),
    committed: sum.committed + number(row.Committed_Amount, 'Committed_Amount', 0),
    actualSpend: sum.actualSpend + number(row.Actual_Spend, 'Actual_Spend', 0)
  }), { budget: 0, committed: 0, actualSpend: 0 }) : null;
  if (finance) {
    finance.uncommittedBudget = finance.budget - finance.committed;
    finance.remainingBudgetAfterActual = finance.budget - finance.actualSpend;
    finance.budgetUtilizationPercent = finance.budget > 0 ? finance.actualSpend / finance.budget * 100 : null;
    finance.overBudget = finance.actualSpend > finance.budget;
    finance.overCommitment = finance.committed > finance.budget;
    finance.uncommittedBudgetNegative = finance.uncommittedBudget < 0;
    finance.remainingBudgetNegative = finance.remainingBudgetAfterActual < 0;
    finance.currency = null; // Financial_Monitoring rows do not expose a verified currency field here.
  }

  const warnings = [];
  if (!baseline) warnings.push('No approved Project_Baselines snapshot was found');
  else if (baselineComparison.some(row => !row.hasSnapshotMatch)) warnings.push('Some active activities are absent from the latest approved baseline snapshot');
  if (!finance) warnings.push('No Financial_Monitoring rows are available');
  if (criticalOpenRisks.length) warnings.push(criticalOpenRisks.length + ' open high/critical risks require management attention');
  if (openIssues.length) warnings.push(openIssues.length + ' open issues remain unresolved');
  if (delayedActivities.length) warnings.push(delayedActivities.length + ' activities are forecast late or have slipped beyond baseline finish');
  if (delayedMilestones.length) warnings.push(delayedMilestones.length + ' milestones are overdue at the report status date');
  if (finance && finance.overBudget) warnings.push('Actual spending exceeds the recorded project budget');
  if (finance && finance.overCommitment) warnings.push('Committed amounts exceed the recorded project budget');
  warnings.push('EVM PV and EV are not inferred from progress percentages or budget categories; provide approved time-phased valuation data before calculating SPI/CPI.');
  return {
    projectId, projectName: String(project.Project_Name || ''),
    statusDate,
    schedule: { durationInWorkingDays: cpm.projectDuration, criticalActivities: cpm.criticalActivities, activities: cpm.activities },
    progress: { planned, actual, variancePercentagePoints: planned.available && actual.available ? actual.value - planned.value : null },
    baseline: baseline ? { id: baseline.Baseline_ID, revision: Number(baseline.Revision_Number) || null, name: baseline.Baseline_Name || '', approvedDate: date(baseline.Approved_Date) } : null,
    baselineComparison,
    scheduleAlerts: { delayedActivityCount: delayedActivities.length, overdueMilestoneCount: delayedMilestones.length, delayedActivities, overdueMilestones: delayedMilestones },
    milestones,
    riskSummary: { total: risks.length, open: openRisks.length, highOrCriticalOpen: criticalOpenRisks.length, records: risks },
    issueSummary: { total: issues.length, open: openIssues.length, records: issues },
    finance, warnings
  };
}

module.exports = { buildPmsProjectControlsReport };
