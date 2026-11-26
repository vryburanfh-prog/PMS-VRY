'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiCapturePmoSnapshot(');
const end = source.indexOf('\nfunction parsePhase20DateSafe_(', start);
assert.ok(start >= 0 && end > start, 'snapshot API source boundaries found');
const api = source.slice(start, end);
test('snapshot IDs use the monotonic allocator', () => {
  assert.match(api, /Snapshot_ID:\s*generateNextId_\(resolvePhase19TabName_\(\), 'Snapshot_ID', 'SNP', 5\)/);
  assert.doesNotMatch(api, /Snapshot_ID:\s*'SNP-'[\s\S]*Utilities\.getUuid\(\)/);
});
test('snapshot append is guarded by ScriptLock and invalidates its table cache', () => {
  const lock = api.indexOf('lock.waitLock(15000)');
  const append = api.indexOf('sheet.appendRow(rowValues)');
  const release = api.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && append > lock && release > append, 'lock encloses append');
  assert.match(api, /invalidateTableCache_\(resolvePhase19TabName_\(\)\)/);
});
test('audit failure is surfaced as warning without implying snapshot write failed', () => {
  assert.match(api, /catch \(auditError\)/);
  assert.match(api, /Snapshot was saved, but audit logging failed:/);
  assert.match(api, /if \(auditWarning\) response\.warning = auditWarning/);
});
