const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiCreateProjectBaseline(projectId, baselineName, remarks)');
const end = source.indexOf('\nfunction ', start + 10);
assert.ok(start >= 0 && end > start, 'baseline creation function exists');
const fn = source.slice(start, end);

test('baseline revision selection and snapshot insertion are serialized', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const baselineRead = fn.indexOf('getTableRecords_(DB_CONFIG.TABS.BASELINES)');
  const nextRevision = fn.indexOf('const nextRev =');
  const idGeneration = fn.indexOf("generateNextId_(DB_CONFIG.TABS.BASELINES");
  const snapshotRead = fn.indexOf('getTableRecords_(DB_CONFIG.TABS.MAIN_WBS)');
  const insert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.BASELINES, record)');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'CREATE_BASELINE'");
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && baselineRead > lock && nextRevision > baselineRead && idGeneration > nextRevision);
  assert.ok(snapshotRead > lock && insert > snapshotRead && audit > insert && release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
