const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const databaseSource = fs.readFileSync('Database.gs', 'utf8');
const start = databaseSource.indexOf('function generateNextId_(');
const end = databaseSource.indexOf('function getNowTimestamp_(', start);
assert.ok(start >= 0 && end > start, 'allocator function boundaries exist');
const allocatorSource = databaseSource.slice(start, end);

function harness({ headers = ['Project_ID', 'Name'], ids = ['PRJ-007'], properties = {} } = {}) {
  let locked = false, waits = 0, releases = 0;
  const stored = Object.assign({}, properties);
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => ids.length + 1,
    getRange(row, col, rows, cols) {
      if (row === 1) return { getValues: () => [headers] };
      return { getValues: () => ids.map(id => [id]) };
    }
  };
  const context = {
    LockService: { getScriptLock: () => ({
      hasLock: () => locked,
      waitLock: ms => { assert.equal(ms, 15000); waits++; locked = true; },
      releaseLock: () => { releases++; locked = false; }
    }) },
    getMasterSpreadsheet_: () => ({ getSheetByName: name => name === 'Projects' ? sheet : null }),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
      setProperty: (key, value) => { stored[key] = String(value); }
    }) },
    encodeURIComponent, Number, String, Math, parseInt
  };
  vm.runInNewContext(allocatorSource, context);
  return { allocate: context.generateNextId_, stored, stats: () => ({ waits, releases, locked }) };
}

test('allocator reconciles the sheet max and returns monotonic IDs even before inserts', () => {
  const h = harness({ ids: ['PRJ-007', 'PRJ-009', 'PRJ-009X', 'OTHER-099'] });
  assert.equal(h.allocate('Projects', 'Project_ID', 'PRJ', 3), 'PRJ-010');
  assert.equal(h.allocate('Projects', 'Project_ID', 'PRJ', 3), 'PRJ-011');
  assert.equal(h.stats().waits, 2);
  assert.equal(h.stats().releases, 2);
  assert.equal(h.stats().locked, false);
});

test('allocator honors a persisted counter ahead of current sheet contents', () => {
  const h = harness({ ids: ['PRJ-002'], properties: { 'ID_ALLOCATOR_V1:Projects:Project_ID:PRJ': '15' } });
  assert.equal(h.allocate('Projects', 'Project_ID', 'PRJ', 3), 'PRJ-016');
});

test('allocator supports a caller that already owns the script lock', () => {
  let locked = true, releases = 0;
  const headers = ['Project_ID'];
  const sheet = { getLastColumn: () => 1, getLastRow: () => 1, getRange: () => ({ getValues: () => [headers] }) };
  const context = {
    LockService: { getScriptLock: () => ({ hasLock: () => locked, waitLock: () => { throw new Error('should not wait'); }, releaseLock: () => { releases++; } }) },
    getMasterSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    encodeURIComponent, Number, String, Math, parseInt
  };
  vm.runInNewContext(allocatorSource, context);
  assert.equal(context.generateNextId_('Projects', 'Project_ID', 'PRJ', 3), 'PRJ-001');
  assert.equal(releases, 0);
});

test('allocator fails closed for missing sheet or primary-key header', () => {
  const h = harness();
  assert.throws(() => h.allocate('Missing', 'Project_ID', 'PRJ', 3), /table not found/);
  const bad = harness({ headers: ['Name'], ids: [] });
  assert.throws(() => bad.allocate('Projects', 'Project_ID', 'PRJ', 3), /column.*missing/);
});
