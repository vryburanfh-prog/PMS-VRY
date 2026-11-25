'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPmsProjectControlsReport } = require('../src/pms-project-controls');

const project = { Project_ID: 'P-1', Project_Name: 'Sample' };
const activities = [
  { Project_ID: 'P-1', Activity_ID: 'A', Baseline_Duration: 2, Activity_Weight: 60, Planned_Progress: 50, Actual_Progress: 40, Baseline_Start_Date: '2026-01-01', Baseline_Finish_Date: '2026-01-03' },
  { Project_ID: 'P-1', Activity_ID: 'B', Baseline_Duration: 3, Activity_Weight: 40, Planned_Progress: 25, Actual_Progress: 20, Baseline_Start_Date: '2026-01-03', Baseline_Finish_Date: '2026-01-06' }
];
const dependencies = [{ Project_ID: 'P-1', Predecessor_ID: 'A', Successor_ID: 'B', Dependency_Type: 'FS', Lag_Or_Lead_Days: 0, Is_Active: 'TRUE' }];
const baseline = { Project_ID: 'P-1', Baseline_ID: 'BL-001', Revision_Number: 1, Baseline_Name: 'Approved', Approved_Date: '2026-01-01',
  Snapshot_JSON: JSON.stringify({ activities: activities.map(x => ({ ...x })) }) };

test('adapts real PMS activity, dependency, baseline and financial row fields', () => {
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities, dependencies, baselines: [baseline],
    financialItems: [{ Project_ID: 'P-1', Budget_Amount: 1000, Committed_Amount: 400, Actual_Spend: 300 }]
  });
  assert.equal(report.schedule.durationInWorkingDays, 5);
  assert.deepEqual(report.schedule.criticalActivities, ['A', 'B']);
  assert.equal(report.progress.planned.value, 40);
  assert.equal(report.progress.actual.value, 32);
  assert.equal(report.progress.variancePercentagePoints, -8);
  assert.equal(report.baseline.id, 'BL-001');
  assert.equal(report.baselineComparison.every(x => x.hasSnapshotMatch), true);
  assert.equal(report.finance.remainingBudgetAfterActual, 700);
  assert.ok(report.warnings.some(x => x.includes('EVM PV and EV are not inferred')));
});

test('rejects cross-project dependency and unsupported relationship types', () => {
  assert.throws(() => buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    dependencies: [{ Project_ID: 'P-1', Predecessor_ID: 'OTHER', Successor_ID: 'B', Dependency_Type: 'FS' }]
  }), /outside the active project schedule/);
  assert.throws(() => buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    dependencies: [{ Project_ID: 'P-1', Predecessor_ID: 'A', Successor_ID: 'B', Dependency_Type: 'SS' }]
  }), /supports Finish-to-Start/);
});

test('isolates projects and ignores archived activities and inactive dependencies', () => {
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01',
    activities: [...activities, { Project_ID: 'P-1', Activity_ID: 'ARCH', Is_Archived: 'TRUE' },
      { Project_ID: 'P-2', Activity_ID: 'OTHER', Baseline_Duration: 1 }],
    dependencies: [{ Project_ID: 'P-1', Predecessor_ID: 'A', Successor_ID: 'B', Is_Active: 'FALSE' }]
  });
  assert.equal(report.schedule.activities.length, 2);
  assert.deepEqual(report.schedule.criticalActivities, ['B']);
});

test('reports missing baseline and missing weights as data-quality gaps', () => {
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01',
    activities: activities.map(x => ({ ...x, Activity_Weight: 0 }))
  });
  assert.equal(report.progress.actual.available, false);
  assert.equal(report.baseline, null);
  assert.ok(report.warnings.length >= 3);
});


test('reports schedule slippage, overdue milestones and financial overruns', () => {
  const delayedActivities = activities.map((row, index) => ({
    ...row,
    Forecast_Finish_Date: index === 0 ? '2026-01-10' : '2026-01-06',
    Actual_Finish_Date: '',
    Status: 'In Progress'
  }));
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-01-05',
    activities: delayedActivities,
    baselines: [baseline],
    milestones: [
      { Project_ID: 'P-1', Milestone_ID: 'M-1', Milestone_Name: 'Approval', Forecast_Date: '2026-01-04', Milestone_Status: 'In Progress' },
      { Project_ID: 'P-1', Milestone_ID: 'M-2', Milestone_Name: 'Handover', Forecast_Date: '2026-01-12', Milestone_Status: 'Not Started' }
    ],
    financialItems: [{ Project_ID: 'P-1', Budget_Amount: 100, Committed_Amount: 120, Actual_Spend: 130 }]
  });
  assert.equal(report.scheduleAlerts.overdueMilestoneCount, 1);
  assert.equal(report.scheduleAlerts.delayedActivityCount, 1);
  assert.equal(report.scheduleAlerts.overdueMilestones[0].id, 'M-1');
  assert.equal(report.finance.overBudget, true);
  assert.equal(report.finance.overCommitment, true);
  assert.ok(report.warnings.some(x => x.includes('Actual spending exceeds')));
});

test('does not flag completed milestones as overdue', () => {
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    milestones: [{ Project_ID: 'P-1', Milestone_ID: 'M-1', Forecast_Date: '2026-01-01', Milestone_Status: 'Completed' }]
  });
  assert.equal(report.scheduleAlerts.overdueMilestoneCount, 0);
});


test('summarizes open risks, high/critical exposure and unresolved issues', () => {
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    risks: [
      { Project_ID: 'P-1', Risk_ID: 'R-1', Risk_Rating: '15 - Critical', Current_Status: 'Open' },
      { Project_ID: 'P-1', Risk_ID: 'R-2', Risk_Rating: '10 - High', Current_Status: 'Mitigating' },
      { Project_ID: 'P-1', Risk_ID: 'R-3', Risk_Rating: '20 - Critical', Current_Status: 'Closed' },
      { Project_ID: 'P-2', Risk_ID: 'R-4', Risk_Rating: '25 - Critical', Current_Status: 'Open' }
    ],
    issues: [
      { Project_ID: 'P-1', Issue_ID: 'I-1', Issue_Status: 'Open' },
      { Project_ID: 'P-1', Issue_ID: 'I-2', Issue_Status: 'Resolved' },
      { Project_ID: 'P-2', Issue_ID: 'I-3', Issue_Status: 'Open' }
    ]
  });
  assert.equal(report.riskSummary.total, 3);
  assert.equal(report.riskSummary.open, 2);
  assert.equal(report.riskSummary.highOrCriticalOpen, 2);
  assert.equal(report.issueSummary.total, 2);
  assert.equal(report.issueSummary.open, 1);
  assert.ok(report.warnings.some(x => x.includes('high/critical risks')));
  assert.ok(report.warnings.some(x => x.includes('open issues')));
});

test('excludes archived risks and issues from management summaries', () => {
  const report = buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    risks: [{ Project_ID: 'P-1', Risk_ID: 'R-1', Risk_Rating: '15 - Critical', Current_Status: 'Open', Is_Archived: 'TRUE' }],
    issues: [{ Project_ID: 'P-1', Issue_ID: 'I-1', Issue_Status: 'Open', Is_Archived: 'TRUE' }]
  });
  assert.equal(report.riskSummary.total, 0);
  assert.equal(report.issueSummary.total, 0);
});

test('validates status date and malformed baseline JSON', () => {
  assert.throws(() => buildPmsProjectControlsReport({ project, statusDate: '02/01/2026', activities }), /YYYY-MM-DD/);
  assert.throws(() => buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    baselines: [{ Project_ID: 'P-1', Revision_Number: 2, Snapshot_JSON: '{bad' }]
  }), /Snapshot_JSON is invalid/);
});
