'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessProjectHealth } = require('../src/project-health');

const thresholds = {
  schedule: { greenMin: 0.95, amberMin: 0.85 },
  cost: { greenMin: 0.95, amberMin: 0.85 }
};

test('health is green when both dimensions meet configured green thresholds', () => {
  const result = assessProjectHealth({ spi: 1, cpi: 0.98, thresholds });
  assert.equal(result.overall, 'green');
  assert.deepEqual(result.alerts, []);
});

test('health reports amber and red with explainable dimension alerts', () => {
  const amber = assessProjectHealth({ spi: 0.9, cpi: 1, thresholds });
  assert.equal(amber.overall, 'amber');
  assert.equal(amber.alerts[0].code, 'SCHEDULE_AMBER');

  const red = assessProjectHealth({ spi: 0.7, cpi: 0.8, thresholds });
  assert.equal(red.overall, 'red');
  assert.deepEqual(red.alerts.map(x => x.code), ['SCHEDULE_RED', 'COST_RED']);
});

test('missing metrics produce incomplete health and data alerts, not false green', () => {
  const result = assessProjectHealth({ spi: null, cpi: 1, thresholds });
  assert.equal(result.overall, 'incomplete');
  assert.equal(result.dimensions.schedule.status, 'unavailable');
  assert.equal(result.alerts[0].code, 'SCHEDULE_DATA_UNAVAILABLE');
});

test('organization thresholds are mandatory and validated', () => {
  assert.throws(() => assessProjectHealth({ spi: 1, cpi: 1 }), /thresholds are required/);
  assert.throws(() => assessProjectHealth({
    spi: 1, cpi: 1,
    thresholds: { schedule: { greenMin: 0.8, amberMin: 0.9 }, cost: thresholds.cost }
  }), /amberMin <= greenMin/);
});
