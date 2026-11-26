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

for (const [name, permission, table] of [
  ['apiSaveMainWbs', "assertPrivilegedWbsRole_(payload.Project_ID, isUpdate ? 'edit' : 'create')", 'DB_CONFIG.TABS.MAIN_WBS'],
  ['apiSaveSubWbs', "assertPrivilegedWbsRole_(payload.Project_ID, isUpdate ? 'edit' : 'create')", 'DB_CONFIG.TABS.SUB_WBS'],
  ['apiSaveActivity', 'assertScheduleActivityPermission_(payload.Project_ID, isUpdate ? \'edit\' : \'create\', existing)', 'DB_CONFIG.TABS.ACTIVITIES']
]) {
  test(name + ' serializes authorization, record save, and audit', () => {
    const body = bodyFor(name);
    const lock = body.indexOf('LockService.getScriptLock()');
    const wait = body.indexOf('lock.waitLock(15000)');
    const auth = body.indexOf(permission);
    const write = Math.min(...['updateRecordById_','insertRecord_'].map(x => body.indexOf(x)).filter(x => x >= 0));
    const audit = body.indexOf('writeAuditLog_(');
    assert.ok(lock >= 0 && wait > lock, 'lock acquisition is present');
    assert.ok(auth > wait, 'authorization is protected');
    assert.ok(write > auth, 'record mutation follows authorization');
    assert.ok(audit > write, 'audit logging follows mutation');
    assert.match(body, /finally\s*\{[\s\S]*?lock\.releaseLock\(\);?\s*\}/, 'lock is released in finally');
  });
}

test('activity save keeps dependency synchronization inside lock scope', () => {
  const body = bodyFor('apiSaveActivity');
  const lock = body.indexOf('lock.waitLock(15000)');
  const dependencySync = body.indexOf('const dependencyRows =');
  const dependencyWrite = body.indexOf('updateRecordById_(DB_CONFIG.TABS.DEPENDENCIES');
  const dependencyInsert = body.indexOf('insertRecord_(DB_CONFIG.TABS.DEPENDENCIES');
  const release = body.lastIndexOf('lock.releaseLock()');
  assert.ok(dependencySync > lock, 'dependency synchronization is lock-protected');
  assert.ok(dependencyWrite > dependencySync && dependencyInsert > dependencySync, 'dependency changes occur after synchronization lookup');
  assert.ok(release > dependencyWrite && release > dependencyInsert, 'lock remains held through dependency mutations');
});
