const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const fn = source.match(/function apiDeleteProjectControlRecord\([\s\S]*?\n\}/);
assert.ok(fn, 'delete API should exist');
const body = fn[0];

test('project controls deletion is serialized from permission check through audit', () => {
  const lock = body.indexOf('LockService.getScriptLock()');
  const wait = body.indexOf('lock.waitLock(15000)');
  const permission = body.indexOf("assertPermission_(cfg.module, 'delete', pid)");
  const lookup = body.indexOf('findRecordRowById_(cfg.tab, cfg.idCol, recordId)');
  const deleteRow = body.indexOf('sheet.deleteRow(existing._rowIndex)');
  const audit = body.indexOf('writeAuditLog_(ctx,');
  const release = body.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && wait > lock, 'lock should be acquired before mutation scope');
  assert.ok(permission > wait, 'permission must be checked inside the lock');
  assert.ok(lookup > permission, 'record lookup must occur after permission check while locked');
  assert.ok(deleteRow > lookup, 'row deletion must occur after ownership validation and lookup');
  assert.ok(audit > deleteRow, 'audit logging must follow deletion within lock scope');
  assert.ok(release > audit, 'lock release must occur in finally after audit');
  assert.match(body, /finally\s*\{\s*lock\.releaseLock\(\);?\s*\}/, 'release should be guaranteed by finally');
});

test('project controls deletion keeps project ownership guard', () => {
  assert.match(body, /String\(existing\.Project_ID\s*\|\|\s*''\)\.trim\(\)\s*!==\s*pid/);
  assert.match(body, /Record does not belong to the active project/);
});

test('project controls deletion retains required input and missing-record guards', () => {
  assert.match(body, /Project_ID and Record ID are required/);
  assert.match(body, /Record not found:/);
});
