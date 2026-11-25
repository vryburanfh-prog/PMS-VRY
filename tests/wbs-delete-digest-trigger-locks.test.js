const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function bodyFor(name) {
  const m = source.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}'));
  assert.ok(m, name + ' should exist');
  return m[0];
}
test('apiDeleteWbsRecord serializes validation, dependency checks, deletion and audit', () => {
  const body = bodyFor('apiDeleteWbsRecord');
  const lock = body.indexOf('LockService.getScriptLock()');
  const wait = body.indexOf('lock.waitLock(15000)');
  const auth = body.indexOf('assertPrivilegedWbsRole_(');
  const deleteCall = body.indexOf('deleteRecordById_(');
  const audit = body.indexOf('writeAuditLog_(');
  const release = body.lastIndexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && wait > lock, 'acquires script lock');
  assert.ok(auth > wait, 'permission check protected');
  assert.ok(deleteCall > auth, 'deletion follows authorization and checks');
  assert.ok(audit > deleteCall, 'audit protected');
  assert.ok(release > audit, 'release after deletion and audit');
  assert.match(body, /finally\\s*\\{[\\s\\S]*?lock\\.releaseLock\\(\\);?\\s*\\}/, 'releases in finally');
});
test('apiSaveDigestTriggerConfig serializes properties and trigger replacement', () => {
  const body = bodyFor('apiSaveDigestTriggerConfig');
  const lock = body.indexOf('LockService.getScriptLock()');
  const wait = body.indexOf('lock.waitLock(15000)');
  const auth = body.indexOf('assertPermission_(');
  const props = body.indexOf('setProperty(PHASE17_PROP_KEY_');
  const triggerDelete = body.indexOf('ScriptApp.deleteTrigger(t)');
  const triggerCreate = body.indexOf('builder.create()');
  const audit = body.indexOf('writeAuditLog_(');
  const release = body.lastIndexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && wait > lock, 'acquires script lock');
  assert.ok(auth > wait, 'authorization protected');
  assert.ok(props > auth, 'config persistence protected');
  assert.ok(triggerDelete > props && triggerCreate > triggerDelete, 'trigger replacement protected');
  assert.ok(audit > triggerCreate && release > audit, 'audit and release follow');
  assert.match(body, /finally\\s*\\{[\\s\\S]*?lock\\.releaseLock\\(\\);?\\s*\\}/, 'releases in finally');
});
