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
test('manual PMO digest dispatch serializes authorization, validation, email and audit', () => {
  const body = bodyFor('apiDispatchPmoDigestEmail');
  const lock = body.indexOf('LockService.getScriptLock()');
  const wait = body.indexOf('lock.waitLock(15000)');
  const auth = body.indexOf('assertPrivilegedManagementRole_(');
  const validation = body.indexOf('if (!toList.length)');
  const send = body.indexOf('MailApp.sendEmail(');
  const audit = body.indexOf('writeAuditLog_(');
  const release = body.lastIndexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && wait > lock, 'acquires script lock');
  assert.ok(auth > wait, 'authorization inside lock');
  assert.ok(validation > auth && send > validation, 'validates recipient/content before send');
  assert.ok(audit > send && release > audit, 'audit and release follow email send');
  assert.equal((body.match(/finally/g) || []).length, 1, 'exactly one finally block');
  assert.equal((body.match(/lock\.releaseLock\(\)/g) || []).length, 1, 'exactly one lock release');
});

test('scheduled PMO digest dispatch is serialized', () => {
  const body = bodyFor('runScheduledPmoDigestTrigger_');
  const lock = body.indexOf('LockService.getScriptLock()');
  const wait = body.indexOf('lock.waitLock(15000)');
  const send = body.indexOf('MailApp.sendEmail(');
  const release = body.lastIndexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && wait > lock, 'acquires script lock');
  assert.ok(send > wait && release > send, 'scheduled email is protected and lock released afterward');
  assert.equal((body.match(/finally/g) || []).length, 1, 'exactly one finally block');
  assert.equal((body.match(/lock\.releaseLock\(\)/g) || []).length, 1, 'exactly one lock release');
});
