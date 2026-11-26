const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function bodyFor(name) {
  const match = source.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}'));
  assert.ok(match, name + ' should exist');
  return match[0];
}

for (const [name, permission, mutation] of [
  ['apiUpdateProject', "assertPermission_('Projects', 'edit', projectId)", 'updateRecordById_'],
  ['apiArchiveProject', "assertPermission_('Projects', 'edit', projectId)", 'updateRecordById_'],
  ['apiSetWbsRecordArchived', "assertPrivilegedWbsRole_(projectId, 'edit')", 'updateRecordById_']
]) {
  test(name + ' is serialized across authorization, write, audit, and release', () => {
    const body = bodyFor(name);
    const lock = body.indexOf('LockService.getScriptLock()');
    const wait = body.indexOf('lock.waitLock(15000)');
    const permissionCheck = body.indexOf(permission);
    const write = body.indexOf(mutation);
    const audit = body.indexOf('writeAuditLog_(');
    const release = body.indexOf('lock.releaseLock()');
    assert.ok(lock >= 0 && wait > lock, 'acquire lock before protected operations');
    assert.ok(permissionCheck > wait, 'authorization should occur inside lock');
    assert.ok(write > permissionCheck, 'write should follow authorization');
    assert.ok(audit > write, 'audit should follow mutation');
    assert.ok(release > audit, 'release after audit');
    assert.match(body, /finally\s*\{[\s\S]*?lock\.releaseLock\(\);?\s*\}/, 'release lock in finally');
  });
}
