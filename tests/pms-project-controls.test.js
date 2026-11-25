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

test('validates status date and malformed baseline JSON', () => {
  assert.throws(() => buildPmsProjectControlsReport({ project, statusDate: '02/01/2026', activities }), /YYYY-MM-DD/);
  assert.throws(() => buildPmsProjectControlsReport({
    project, statusDate: '2026-02-01', activities,
    baselines: [{ Project_ID: 'P-1', Revision_Number: 2, Snapshot_JSON: '{bad' }]
  }), /Snapshot_JSON is invalid/);
});
