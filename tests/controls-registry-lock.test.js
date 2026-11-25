const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiSaveProjectControlRecord(projectId, registryKey, payload)');
const end = source.indexOf('function apiDeleteProjectControlRecord(', start);
assert.ok(start >= 0 && end > start, 'registry save function exists');
const fn = source.slice(start, end);

test('project controls registry save serializes ID generation, ownership checks, and writes', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const existingRead = fn.indexOf('findRecordRowById_(cfg.tab');
  const permission = fn.indexOf('assertPermission_(cfg.module');
  const generateId = fn.indexOf('generateNextId_(cfg.tab');
  const update = fn.indexOf('updateRecordById_(cfg.tab');
  const insert = fn.indexOf('insertRecord_(cfg.tab');
  const audit = fn.indexOf('writeAuditLog_(ctx,');
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && existingRead > lock && permission > lock);
  assert.ok(generateId > lock && update > lock && insert > lock);
  assert.ok(audit > update && release > audit);
  assert.match(fn, /CREATE_' \\+ cfg\\.module\\.toUpperCase\\(\\)/);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
