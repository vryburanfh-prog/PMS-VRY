'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCpm, calculateEvm } = require('../src/project-controls');

test('CPM calculates a simple critical path and float', () => {
  const result = calculateCpm([
    { id: 'A', duration: 3 },
    { id: 'B', duration: 2, predecessors: ['A'] },
    { id: 'C', duration: 5, predecessors: ['A'] },
    { id: 'D', duration: 1, predecessors: ['B', 'C'] }
  ]);
  assert.equal(result.projectDuration, 9);
  assert.deepEqual(result.criticalActivities, ['A', 'C', 'D']);
  assert.deepEqual(result.activities.find(x => x.id === 'B'), {
    id: 'B', duration: 2, es: 3, ef: 5, lf: 8, ls: 6, totalFloat: 3, critical: false
  });
});

test('CPM supports disconnected activities and zero duration', () => {
  const result = calculateCpm([
    { id: 'A', duration: 0 },
    { id: 'B', duration: 4 }
  ]);
  assert.equal(result.projectDuration, 4);
  assert.deepEqual(result.criticalActivities, ['B']);
});

test('CPM rejects duplicate ids, missing dependencies, cycles and invalid durations', () => {
  assert.throws(() => calculateCpm([{ id: 'A', duration: 1 }, { id: 'A', duration: 2 }]), /duplicate activity/);
  assert.throws(() => calculateCpm([{ id: 'A', duration: 1, predecessors: ['X'] }]), /unknown predecessor/);
  assert.throws(() => calculateCpm([{ id: 'A', duration: 1, predecessors: ['B'] }, { id: 'B', duration: 1, predecessors: ['A'] }]), /cycle/);
  assert.throws(() => calculateCpm([{ id: 'A', duration: -1 }]), /non-negative/);
});

test('EVM computes core performance and forecasts', () => {
  const result = calculateEvm({ bac: 1000, pv: 500, ev: 400, ac: 500, baselineDuration: 20 });
  assert.equal(result.cv.value, -100);
  assert.equal(result.sv.value, -100);
  assert.equal(result.cpi.value, 0.8);
  assert.equal(result.spi.value, 0.8);
  assert.equal(result.eac.value, 1250);
  assert.equal(result.etc.value, 750);
  assert.equal(result.vac.value, -250);
  assert.equal(result.tcpi.value, 1.2);
  assert.equal(result.durationForecast.value, 25);
});

test('EVM marks zero-denominator metrics unavailable instead of returning Infinity or zero', () => {
  const result = calculateEvm({ bac: 100, pv: 0, ev: 0, ac: 0 });
  assert.equal(result.cpi.available, false);
  assert.equal(result.spi.available, false);
  assert.equal(result.eac.available, false);
  assert.equal(result.durationForecast.available, false);
  assert.equal(result.cv.value, 0);
});

test('EVM rejects negative and non-finite inputs', () => {
  assert.throws(() => calculateEvm({ bac: -1, pv: 0, ev: 0, ac: 0 }), /non-negative/);
  assert.throws(() => calculateEvm({ bac: 1, pv: 0, ev: NaN, ac: 0 }), /non-negative/);
});
