'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('Database.gs', 'utf8');
const start = source.indexOf('function insertRecords_(');
const end = source.indexOf('function updateRecordById_(', start);
assert.ok(start >= 0 && end > start, 'insertRecords_ helper boundaries exist');
const helper = source.slice(start, end);
function createSheet({failWrite = false} = {}) {
  const headers = ['Permission_ID', 'Role_ID', 'Module', 'Permission'];
  const existingRows = [['PERM-001', 'R-1', 'Projects', 'view']];
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => existingRows.length + 1,
    getRange(row, col, numRows, numCols) {
      return {
        getValues() {
          if (row === 1) return [headers.slice(col - 1, col - 1 + numCols)];
          if (row === 2 && col === 1 && numCols === 1) return existingRows.map(r => [r[0]]);
          return [];
        },
        setValues(values) {
          if (failWrite) throw new Error('simulated sheet write failure');
          existingRows.push(...values);
        }
      };
    }
  };
  return {sheet, existingRows};
}
function runInsert({failWrite = false} = {}) {
  const {sheet, existingRows} = createSheet({failWrite});
  const invalidations = [];
  const lock = {hasLock: () => false, waitLock: () => {}, releaseLock: () => {}};
  const context = {
    LockService: {getScriptLock: () => lock},
    getMasterSpreadsheet_: () => ({getSheetByName: () => sheet}),
    assertUniquePrimaryKeyForInsert_: () => {},
    invalidateTableCache_: name => invalidations.push(name)
  };
  vm.createContext(context);
  vm.runInContext(helper, context);
  return {result: () => context.insertRecords_('Role_Permissions', [
    {Permission_ID: 'PERM-002', Role_ID: 'R-2', Module: 'Risks', Permission: 'view'}
  ]), invalidations, existingRows};
}
test('bulk insert invalidates table cache after a successful write', () => {
  const state = runInsert();
  assert.equal(state.result(), 1);
  assert.deepEqual(state.invalidations, ['Role_Permissions']);
  assert.equal(state.existingRows.length, 2);
});
test('bulk insert does not invalidate cache when the sheet write fails', () => {
  const state = runInsert({failWrite: true});
  assert.throws(() => state.result(), /simulated sheet write failure/);
  assert.deepEqual(state.invalidations, []);
  assert.equal(state.existingRows.length, 1);
});
