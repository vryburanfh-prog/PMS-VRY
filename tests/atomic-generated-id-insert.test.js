const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Database.gs'), 'utf8');
const start = source.indexOf('function insertRecordWithGeneratedId_(');
const end = source.indexOf('\nfunction ', start + 1);
assert.notEqual(start, -1, 'atomic generated-ID insert helper must exist');
const helperSource = source.slice(start, end === -1 ? source.length : end);

function harness(existingIds, failWrite) {
  const headers = ['Name', 'Project_ID', 'Baseline_ID', 'Remarks'];
  const rows = [headers, ...existingIds.map(id => ['existing', 'P-1', id, ''])];
  const events = [];
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length,
    getRange(row, col, numRows, numCols) {
      events.push('read:' + row + ':' + col);
      return {
        getValues() {
          if (row === 1) return [headers.slice(col - 1, col - 1 + numCols)];
          return rows.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols));
        },
        setValues(values) {
          events.push('write');
          if (failWrite) throw new Error('mock write failure');
          rows.push(values[0]);
        }
      };
    }
  };
  const lock = { waitLock: ms => events.push('lock:' + ms), releaseLock: () => events.push('unlock') };
  const sandbox = {
    LockService: { getScriptLock: () => lock },
    getMasterSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    invalidateTableCache_: tab => events.push('invalidate:' + tab),
    String, Math, RegExp, Set, Error
  };
  const fn = vm.runInNewContext('(' + helperSource + ')', sandbox);
  return { fn, rows, events };
}

test('generated ID and row insertion are performed under one lock; header mapping and collision retry work', () => {
  const h = harness(['BL-001', 'BL-002'], false);
  const record = { Name: 'Baseline', Project_ID: 'P-1', Remarks: 'test' };
  const id = h.fn('Project_Baselines', 'Baseline_ID', 'BL', 3, record);
  assert.equal(id, 'BL-003');
  assert.equal(record.Baseline_ID, id);
  assert.deepEqual(Array.from(h.rows.at(-1)), ['Baseline', 'P-1', 'BL-003', 'test']);
  const lockAt = h.events.indexOf('lock:10000');
  const readAt = h.events.findIndex(e => e.startsWith('read:'));
  const writeAt = h.events.indexOf('write');
  const unlockAt = h.events.indexOf('unlock');
  const invalidateAt = h.events.indexOf('invalidate:Project_Baselines');
  assert.ok(lockAt >= 0 && lockAt < readAt && readAt < writeAt && writeAt < unlockAt);
  assert.ok(unlockAt < invalidateAt);
});

test('lock is released when insertion fails', () => {
  const h = harness([], true);
  assert.throws(() => h.fn('Project_Baselines', 'Baseline_ID', 'BL', 3, { Project_ID: 'P-1' }), /mock write failure/);
  assert.ok(h.events.includes('unlock'));
  assert.ok(!h.events.includes('invalidate:Project_Baselines'));
});

test('helper rejects a missing ID column before attempting a write and releases lock', () => {
  const h = harness([], false);
  assert.throws(() => h.fn('Project_Baselines', 'Missing_ID', 'BL', 3, {}), /Column "Missing_ID" not found/);
  assert.ok(h.events.includes('unlock'));
  assert.ok(!h.events.includes('write'));
});
