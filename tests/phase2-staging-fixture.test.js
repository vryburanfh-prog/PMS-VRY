'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/phase2-staging-controls-fixture.json');
const { calculateCpm } = require('../src/project-controls');

function normalizeFixtureDependencies(rows) {
  return rows.map(row => {
    if (row.Relationship_Type !== 'FS' || Number(row.Lag || 0) !== 0) {
      throw new Error('staging fixture CPM supports only FS with zero lag');
    }
    return { predecessor: row.Predecessor_ID, successor: row.Successor_ID };
  });
}

function runFixtureCpm(data) {
  const edges = normalizeFixtureDependencies(data.dependencies);
  const activities = data.schedule.map(row => ({
    id: row.Activity_ID,
    duration: Number(row.Duration),
    predecessors: edges.filter(edge => edge.successor === row.Activity_ID).map(edge => edge.predecessor)
  }));
  return calculateCpm(activities);
}

test('synthetic staging fixture CPM hand-calculation matches the engine', () => {
  const result = runFixtureCpm(fixture);
  assert.equal(result.projectDuration, fixture.expectedCPM.projectDurationWorkingDays);
  assert.deepEqual(result.criticalActivities, fixture.expectedCPM.criticalPathActivityIds);
  const floats = Object.fromEntries(result.activities.map(row => [row.id, row.totalFloat]));
  assert.deepEqual(floats, fixture.expectedCPM.expectedTotalFloatWorkingDays);
});

test('synthetic baseline snapshot hand-counts match fixture expectations', () => {
  const activeIds = new Set(fixture.schedule.map(row => row.Activity_ID));
  const snapshotIds = new Set(fixture.baselineSnapshot.activities.map(row => row.Activity_ID));
  const matched = [...activeIds].filter(id => snapshotIds.has(id)).length;
  const missing = [...activeIds].filter(id => !snapshotIds.has(id)).length;
  const snapshotOnly = [...snapshotIds].filter(id => !activeIds.has(id)).length;
  assert.equal(matched, fixture.expectedBaselineDrift.activeActivitiesMatched);
  assert.equal(missing, fixture.expectedBaselineDrift.activeActivitiesMissingFromSnapshot);
  assert.equal(snapshotOnly, fixture.expectedBaselineDrift.snapshotOnlyActivities);
});

test('fixture normalizer rejects unsupported relationship types or lag', () => {
  assert.throws(() => normalizeFixtureDependencies([{ Relationship_Type: 'SS', Lag: 0 }]), /FS with zero lag/);
  assert.throws(() => normalizeFixtureDependencies([{ Relationship_Type: 'FS', Lag: 2 }]), /FS with zero lag/);
});

test('fixture mutation detects a dependency cycle through CPM', () => {
  const mutated = structuredClone(fixture);
  mutated.dependencies.push({ Dependency_ID: 'DEP-CYCLE', Project_ID: fixture.project.Project_ID,
    Predecessor_ID: 'ACT-04', Successor_ID: 'ACT-01', Relationship_Type: 'FS', Lag: 0 });
  assert.throws(() => runFixtureCpm(mutated), /dependency cycle/);
});
