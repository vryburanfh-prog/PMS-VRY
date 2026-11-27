'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('Database.gs', 'utf8');
const start = source.indexOf('function updateRecordById_(');
const end = source.indexOf('function deleteRecordsByIds_(', start);
assert.ok(start >= 0 && end > start, 'update helper boundaries exist');
const helperSource = source.slice(start, end);

function harness() {
  const values = [
    ['Project_ID', 'Name', 'Status'],
    ['PRJ-001', 'Original', 'Active']
  ];
  let locked = false, waits = 0, releases = 0, invalidations = 0, writes = 0;
  const sheet = {
    getLastRow: () => values.length,
    getLastColumn: () => values[0].length,
    getRange(row, col, rows, cols) {
      return {
        getValues() {
          return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => values[row - 1 + r]?.[col - 1 + c] ?? ''));
        },
        setValues(newValues) {
          writes++;
          newValues.forEach((line, r) => line.forEach((v, c) => {
            if (!values[row - 1 + r]) values[row - 1 + r] = [];
            values[row - 1 + r][col - 1 + c] = v;
          }));
        }
      };
    }
  };
  const context = {
    LockService: { getScriptLock: () => ({
      hasLock: () => locked,
      waitLock: ms => { assert.equal(ms, 10000); waits++; locked = true; },
      releaseLock: () => { releases++; locked = false; }
    }) },
    getMasterSpreadsheet_: () => ({ getSheetByName: name => name === 'Projects' ? sheet : null }),
    invalidateTableCache_: () => { invalidations++; },
    String, Object, Array
  };
  vm.runInNewContext(helperSource, context);
  return { update:context.updateRecordById_, values, stats:()=>({locked,waits,releases,invalidations,writes}) };
}

test('record update rejects primary-key changes without writing', () => {
  const h = harness();
  assert.throws(() => h.update('Projects', 'Project_ID', 'PRJ-001', { Project_ID:'PRJ-002', Name:'Changed' }), /Primary-key changes are not allowed/);
  assert.equal(h.values[1][0], 'PRJ-001');
  assert.equal(h.values[1][1], 'Original');
  assert.equal(h.stats().writes, 0);
  assert.equal(h.stats().locked, false);
  assert.equal(h.stats().releases, 1);
});

test('record update permits same primary-key value and normal field updates', () => {
  const h = harness();
  const result = h.update('Projects', 'Project_ID', 'PRJ-001', { Project_ID:'PRJ-001', Name:'Updated' });
  assert.equal(h.values[1][0], 'PRJ-001');
  assert.equal(h.values[1][1], 'Updated');
  assert.equal(result.updated.Project_ID, 'PRJ-001');
  assert.equal(h.stats().writes, 1);
  assert.equal(h.stats().invalidations, 1);
  assert.equal(h.stats().locked, false);
});

test('record update rejects missing records and still releases the lock', () => {
  const h = harness();
  assert.throws(() => h.update('Projects', 'Project_ID', 'PRJ-404', { Name:'No row' }), /not found/);
  assert.equal(h.stats().locked, false);
  assert.equal(h.stats().releases, 1);
});
