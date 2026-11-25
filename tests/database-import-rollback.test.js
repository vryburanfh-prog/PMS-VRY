'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('Code.gs', 'utf8');
const start = code.indexOf('function applyDatabaseImportPlanWithRollback_(');
const end = code.indexOf('\nfunction apiImportDatabaseFromGoogleSheet(', start);
assert.ok(start >= 0 && end > start, 'rollback helper source boundaries found');
const helperSource = code.slice(start, end);
function makeSheet(rows, failFirstSet = false) {
  let maxRows = 100;
  let fail = failFirstSet;
  const sheet = {
    rows: rows.map(r => r.slice()),
    getLastRow() { return sheet.rows.length + 1; },
    getMaxRows() { return maxRows; },
    insertRowsAfter(_after, count) { maxRows += count; },
    getRange(row, _col, count, _cols) {
      return {
        clearContent: () => { if (row === 2) sheet.rows = []; },
        getValues: () => row === 2 ? sheet.rows.slice(0, count).map(r => r.slice()) : [],
        setValues: values => {
          if (fail) { fail = false; throw new Error('simulated destination write failure'); }
          if (row === 2) sheet.rows = values.map(r => r.slice());
        }
      };
    }
  };
  return sheet;
}
function runHarness({failOnB = false} = {}) {
  const originalA = [['A-old-1'], ['A-old-2']];
  const originalB = [['B-old']];
  const destA = makeSheet(originalA);
  const destB = makeSheet(originalB, failOnB);
  const backupA = makeSheet(originalA);
  const backupB = makeSheet(originalB);
  const invalidated = [];
  const context = {
    SpreadsheetApp: {openById: () => ({getSheetByName: name => name === 'A' ? backupA : name === 'B' ? backupB : null})},
    invalidateTableCache_: name => invalidated.push(name)
  };
  vm.createContext(context);
  vm.runInContext(helperSource, context);
  const plan = [
    {tab: 'A', dst: destA, cols: 1, rows: [['A-new']]},
    {tab: 'B', dst: destB, cols: 1, rows: [['B-new']]}
  ];
  return {context, plan, destA, destB, invalidated};
}
test('successful import writes rows and invalidates each destination cache', () => {
  const state = runHarness();
  const result = state.context.applyDatabaseImportPlanWithRollback_(state.plan, 'backup-id', 'backup-url');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{tab:'A',rows:1},{tab:'B',rows:1}]);
  assert.deepEqual(state.destA.rows, [['A-new']]);
  assert.deepEqual(state.destB.rows, [['B-new']]);
  assert.deepEqual(state.invalidated, ['A','B']);
});
test('failed later-tab write restores all touched tabs from backup and invalidates caches', () => {
  const state = runHarness({failOnB:true});
  assert.throws(() => state.context.applyDatabaseImportPlanWithRollback_(state.plan, 'backup-id', 'backup-url'), /Rollback was attempted.*Backup URL: backup-url/);
  assert.deepEqual(state.destA.rows, [['A-old-1'],['A-old-2']]);
  assert.deepEqual(state.destB.rows, [['B-old']]);
  assert.ok(state.invalidated.includes('A'));
  assert.ok(state.invalidated.includes('B'));
});
