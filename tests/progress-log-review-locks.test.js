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
for (const [name, permission] of [
  ['apiSaveProgressLog', "assertPermission_('Progress', isUpdate ? 'edit' : 'create', pid)"],
  ['apiReviewProgressLog', "assertPermission_('Progress', 'approve', pid)"]
]) {
  test(name + ' protects authorization, writes, schedule apply and rollup', () => {
    const body = bodyFor(name);
    const lock = body.indexOf('LockService.getScriptLock()');
    const wait = body.indexOf('lock.waitLock(15000)');
    const auth = body.indexOf(permission);
    const mutation = Math.min(...['updateRecordById_','insertRecord_'].map(x => body.indexOf(x)).filter(x => x >= 0));
    const audit = body.indexOf('writeAuditLog_(');
    const scheduleApply = body.indexOf('updateRecordById_(DB_CONFIG.TABS.ACTIVITIES');
    const rollup = body.indexOf('recalculateProjectProgressEngine_(');
    const release = body.lastIndexOf('lock.releaseLock()');
    assert.ok(lock >= 0 && wait > lock, 'lock acquired');
    assert.ok(auth > wait, 'permission check under lock');
    assert.ok(mutation > auth, 'mutation follows authorization');
    assert.ok(audit > mutation, 'audit follows initial record mutation');
    assert.ok(scheduleApply < 0 || scheduleApply > audit, 'schedule application follows audit within lock');
    assert.ok(rollup < 0 || rollup > wait, 'rollup protected by lock');
    assert.ok(release > Math.max(audit, scheduleApply, rollup), 'release after protected work');
    assert.match(body, /finally\s*\{[\s\S]*?lock\.releaseLock\(\);?\s*\}/);
  });
}
