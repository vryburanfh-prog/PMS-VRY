'use strict';

const { buildPmsPortfolioControlsSummary } = require('./pms-project-controls');

/**
 * Combines the existing authorized apiGetPortfolioData response with optional
 * detailed project-controls reports. The caller must obtain portfolioData from
 * the authenticated PMS API and build each report only from rows authorized
 * for that project. Reports for projects outside the visible portfolio fail
 * closed rather than leaking data into the dashboard.
 */
function buildPmsPortfolioDashboardModel(portfolioData, projectControlReports) {
  if (!portfolioData || portfolioData.success !== true || !Array.isArray(portfolioData.projects)) {
    throw new TypeError('A successful apiGetPortfolioData response is required');
  }
  const visibleProjects = portfolioData.projects;
  const visibleIds = new Set(visibleProjects.map(project => String(project.Project_ID || '').trim()).filter(Boolean));
  if (visibleIds.size !== visibleProjects.length) {
    throw new Error('Portfolio response contains missing or duplicate Project_ID values');
  }
  const reports = Array.isArray(projectControlReports) ? projectControlReports : [];
  reports.forEach(report => {
    const id = String(report && report.projectId || '').trim();
    if (!id || !visibleIds.has(id)) {
      throw new Error('Project controls report is outside the authorized portfolio scope');
    }
  });
  const controls = buildPmsPortfolioControlsSummary(reports);
  const reportById = new Map(reports.map(report => [String(report.projectId), report]));
  const projects = visibleProjects.map(project => {
    const id = String(project.Project_ID).trim();
    const report = reportById.get(id);
    const controlsProject = controls.projects.find(item => item.projectId === id) || null;
    return {
      projectId: id,
      projectName: String(project.Project_Name || ''),
      projectStatus: String(project.Project_Status || ''),
      projectHealth: String(project.Project_Health || ''),
      plannedProgress: Number(project.Overall_Planned_Progress) || 0,
      actualProgress: Number(project.Overall_Actual_Progress) || 0,
      controls: controlsProject,
      drilldown: report ? {
        statusDate: report.statusDate || null,
        progress: report.progress || null,
        baseline: report.baseline ? {
          revision: report.baseline.revision || null,
          approvedDate: report.baseline.approvedDate || null
        } : null,
        schedule: report.schedule ? {
          durationInWorkingDays: report.schedule.durationInWorkingDays,
          criticalActivityCount: Array.isArray(report.schedule.criticalActivities) ? report.schedule.criticalActivities.length : null
        } : null,
        scheduleAlerts: report.scheduleAlerts ? {
          delayedActivityCount: report.scheduleAlerts.delayedActivityCount,
          overdueMilestoneCount: report.scheduleAlerts.overdueMilestoneCount
        } : null,
        risks: report.riskSummary ? {
          total: report.riskSummary.total,
          open: report.riskSummary.open,
          highOrCriticalOpen: report.riskSummary.highOrCriticalOpen
        } : null,
        issues: report.issueSummary ? {
          total: report.issueSummary.total,
          open: report.issueSummary.open
        } : null,
        finance: report.finance ? {
          budget: report.finance.budget,
          committed: report.finance.committed,
          actualSpend: report.finance.actualSpend,
          uncommittedBudget: report.finance.uncommittedBudget,
          remainingBudgetAfterActual: report.finance.remainingBudgetAfterActual,
          overBudget: report.finance.overBudget,
          overCommitment: report.finance.overCommitment,
          currency: report.finance.currency || null
        } : null,
        availability: report.availability || null
      } : null,
      warnings: report && Array.isArray(report.warnings) ? report.warnings.slice() : []
    };
  });
  return {
    success: true,
    source: 'authorized-apiGetPortfolioData',
    portfolioKpis: portfolioData.kpis || {},
    projectControls: controls,
    projects,
    prioritizedProjects: sortProjectsByExceptionPriority(projects)
  };
}



/**
 * Orders visible projects by explicit exception severity, not an invented
 * numeric health score. Priority is based only on available, observed controls.
 * Missing module access/data is surfaced as incomplete coverage.
 */
function prioritizeProjectExceptions(project) {
  if (!project || !project.controls) {
    return {
      level: 'incomplete',
      rank: 5,
      reasons: ['Project controls report is unavailable']
    };
  }
  const c = project.controls;
  const reasons = [];
  let rank = 4;
  if (c.highOrCriticalOpenRisks > 0) {
    reasons.push(c.highOrCriticalOpenRisks + ' open high/critical risk(s)');
    rank = Math.min(rank, 1);
  }
  if (c.overBudget === true) {
    reasons.push('Actual spending exceeds budget');
    rank = Math.min(rank, 1);
  }
  if (c.overdueMilestones > 0) {
    reasons.push(c.overdueMilestones + ' overdue milestone(s)');
    rank = Math.min(rank, 1);
  }
  if (c.overCommitment === true) {
    reasons.push('Committed amount exceeds budget');
    rank = Math.min(rank, 2);
  }
  if (c.delayedActivities > 0) {
    reasons.push(c.delayedActivities + ' delayed activity(ies)');
    rank = Math.min(rank, 2);
  }
  if (c.openIssues > 0) {
    reasons.push(c.openIssues + ' open issue(s)');
    rank = Math.min(rank, 3);
  }
  const coverage = c.availability || {};
  const incomplete = ['schedule', 'milestones', 'risks', 'issues', 'financialMonitoring']
    .some(key => coverage[key] === false) || c.hasFinancialData === false ||
    ['highOrCriticalOpenRisks', 'openIssues', 'overdueMilestones', 'delayedActivities', 'overBudget', 'overCommitment']
      .some(key => c[key] == null);
  if (incomplete) reasons.push('Some controls data is unavailable to this user');
  if (rank === 4 && incomplete) rank = 5;
  const level = rank === 1 ? 'urgent' : rank === 2 ? 'high'
    : rank === 3 ? 'attention' : rank === 5 ? 'incomplete' : 'monitor';
  if (!reasons.length) reasons.push('No recorded exceptions in available controls');
  return { level, rank, reasons };
}

function sortProjectsByExceptionPriority(projects) {
  return projects.map((project, index) => ({
    project,
    originalIndex: index,
    priority: prioritizeProjectExceptions(project)
  })).sort((a, b) => a.priority.rank - b.priority.rank || a.originalIndex - b.originalIndex)
    .map(item => Object.assign({}, item.project, { exceptionPriority: item.priority }));
}

module.exports = { buildPmsPortfolioDashboardModel, prioritizeProjectExceptions, sortProjectsByExceptionPriority };
