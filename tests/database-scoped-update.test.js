'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('Database.gs', 'utf8');
const start = source.indexOf('function updateRecordById_');
const end = source.indexOf('/** Deletes a set of records', start);
assert.ok(start >= 0 && end > start, 'Database.gs update helper boundaries should exist');
const helperSource = source.slice(start, end);

function makeHarness(rows) {
  const sheetValues = rows.map(row => row.slice());
  const writes = [];
  const sheet = {
    getLastRow: () => sheetValues.length,
    getLastColumn: () => sheetValues[0].length,
    getRange(row, col, numRows, numCols) {
      return {
        getValues() {
          return sheetValues.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols));
        },
        setValues(values) {
          writes.push({ row, col, values });
          values.forEach((newRow, rr) => newRow.forEach((value, cc) => { sheetValues[row - 1 + rr][col - 1 + cc] = value; }));
        }
      };
    }
  };
  let lockHeld = false;
  const context = {
    LockService: { getScriptLock: () => ({ hasLock: () => lockHeld, waitLock: () => { lockHeld = true; }, releaseLock: () => { lockHeld = false; } }) },
    getMasterSpreadsheet_: () => ({ getSheetByName: name => name === 'Escalations' ? sheet : null }),
    invalidateTableCache_: () => {},
    Object, String, Error
  };
  vm.createContext(context);
  vm.runInContext(helperSource, context);
  return { call: (...args) => context.updateRecordById_(...args), sheetValues, writes };
}

const baseRows = [
  ['Escalation_ID', 'Project_ID', 'Title', 'Status'],
  ['ESC-1', 'P-1', 'Old title', 'OPEN']
];

test('scoped update succeeds when existing and proposed project scope match', () => {
  const h = makeHarness(baseRows);
  const result = h.call('Escalations', 'Escalation_ID', 'ESC-1', { Title: 'Updated title', Project_ID: 'P-1' }, { field: 'Project_ID', value: 'P-1' });
  assert.equal(result.previous.Title, 'Old title');
  assert.equal(result.updated.Title, 'Updated title');
  assert.equal(h.sheetValues[1][2], 'Updated title');
  assert.equal(h.writes.length, 1);
});

test('scoped update rejects a record from another project before writing', () => {
  const h = makeHarness(baseRows);
  assert.throws(() => h.call('Escalations', 'Escalation_ID', 'ESC-1', { Title: 'Should not write' }, { field: 'Project_ID', value: 'P-2' }), /expected scope/);
  assert.equal(h.sheetValues[1][2], 'Old title');
  assert.equal(h.writes.length, 0);
});

test('scoped update rejects proposed scope changes even when existing row matches', () => {
  const h = makeHarness(baseRows);
  assert.throws(() => h.call('Escalations', 'Escalation_ID', 'ESC-1', { Title: 'Nope', Project_ID: 'P-2' }, { field: 'Project_ID', value: 'P-1' }), /expected scope/);
  assert.equal(h.sheetValues[1][2], 'Old title');
  assert.equal(h.sheetValues[1][1], 'P-1');
  assert.equal(h.writes.length, 0);
});
