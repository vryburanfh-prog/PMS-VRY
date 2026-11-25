const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiSaveProjectControlRecord(projectId, registryKey, payload)');
const end = source.indexOf('function apiDeleteProjectControlRecord(', start);
assert.ok(start >= 0 && end > start, 'project control record mutation function exists');
const fn = source.slice(start, end);

test('control record uniqueness checks, ID generation, mutations, and audit are serialized', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const existingLookup = fn.indexOf('findRecordRowById_(cfg.tab, cfg.idCol, rawId)');
  const permissionCheck = fn.indexOf('assertPermission_(cfg.module');
  const idGeneration = fn.indexOf('generateNextId_(cfg.tab, cfg.idCol');
  const update = fn.indexOf('updateRecordById_(cfg.tab, cfg.idCol');
  const insert = fn.indexOf('insertRecord_(cfg.tab, cleanRecord)');
  const updateAudit = fn.indexOf('writeAuditLog_(ctx, \'UPDATE_');
  const insertAudit = fn.indexOf('writeAuditLog_(ctx, \'CREATE_');
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && existingLookup > lock && permissionCheck > existingLookup && idGeneration > permissionCheck);
  assert.ok(update > lock && insert > lock && updateAudit > update && insertAudit > insert && release > updateAudit && release > insertAudit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
