'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapScheduleRows, mapEvmRow, buildProjectControlsReport } = require('../src/project-controls-adapter');

const scheduleMapping = { id: 'Activity_Code', duration: 'Duration_Days', predecessors: 'Predecessor_Codes' };
const evmMapping = { bac: 'BAC', pv: 'PV', ev: 'EV', ac: 'AC', baselineDuration: 'Baseline_Days' };
const healthThresholds = {
  schedule: { greenMin: 0.95, amberMin: 0.85 },
  cost: { greenMin: 0.95, amberMin: 0.85 }
};

test('maps source rows only through explicit mappings', () => {
  assert.deepEqual(mapScheduleRows([
    { Activity_Code: 'A', Duration_Days: 2, Predecessor_Codes: null },
    { Activity_Code: 'B', Duration_Days: 3, Predecessor_Codes: ['A'] }
  ], scheduleMapping), [
    { id: 'A', duration: 2, predecessors: [] },
    { id: 'B', duration: 3, predecessors: ['A'] }
  ]);
  assert.deepEqual(mapEvmRow({ BAC: 100, PV: 50, EV: 40, AC: 45, Baseline_Days: 10 }, evmMapping),
    { bac: 100, pv: 50, ev: 40, ac: 45, baselineDuration: 10 });
});

test('rejects missing mappings, malformed dependencies and invalid financial values', () => {
  assert.throws(() => mapScheduleRows([{ id: 'A' }], {}), /mapping is required/);
  assert.throws(() => mapScheduleRows([{ id: 'A', days: 1, deps: 'B' }],
    { id: 'id', duration: 'days', predecessors: 'deps' }), /must be an array/);
  assert.throws(() => mapEvmRow({ BAC: -1, PV: 1, EV: 1, AC: 1 },
    { bac: 'BAC', pv: 'PV', ev: 'EV', ac: 'AC' }), /non-negative/);
});

test('builds a read-only schedule, EVM and health report', () => {
  const report = buildProjectControlsReport({
    projectId: 'P-001',
    statusDate: '2026-11-25',
    scheduleRows: [
      { Activity_Code: 'A', Duration_Days: 2, Predecessor_Codes: [] },
      { Activity_Code: 'B', Duration_Days: 3, Predecessor_Codes: ['A'] }
    ],
    scheduleMapping, evmMapping,
    evmRow: { BAC: 100, PV: 50, EV: 40, AC: 45, Baseline_Days: 5 },
    healthThresholds
  });
  assert.equal(report.projectId, 'P-001');
  assert.equal(report.schedule.calculatedDuration, 5);
  assert.deepEqual(report.schedule.criticalActivities, ['A', 'B']);
  assert.equal(report.evm.cpi.value, 40 / 45);
  assert.equal(report.health.overall, 'red');
});

test('does not silently accept missing project identity or status date', () => {
  assert.throws(() => buildProjectControlsReport({
    statusDate: '2026-11-25',
    scheduleRows: [{ Activity_Code: 'A', Duration_Days: 1, Predecessor_Codes: [] }],
    scheduleMapping, evmMapping,
    evmRow: { BAC: 1, PV: 1, EV: 1, AC: 1, Baseline_Days: 1 },
    healthThresholds
  }), /project id/);
});
