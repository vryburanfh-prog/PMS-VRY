const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiDeleteProjectControlRecord(projectId, registryKey, recordId)');
const end = source.indexOf('function ', start + 10);
assert.ok(start >= 0 && end > start, 'project control delete function exists');
const fn = source.slice(start, end);

test('project control delete permission, ownership check, row deletion, and audit are locked', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const permission = fn.indexOf("assertPermission_(cfg.module, 'delete'");
  const lookup = fn.indexOf('findRecordRowById_(cfg.tab, cfg.idCol, recordId)');
  const deleteRow = fn.indexOf('sheet.deleteRow(existing._rowIndex)');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'DELETE_");
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && permission > lock && lookup > permission && deleteRow > lookup && audit > deleteRow && release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
