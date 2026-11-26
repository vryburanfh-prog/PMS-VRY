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
const functions = [
  'apiSaveWeeklyReport','apiDeleteWeeklyReport',
  'apiSaveTeamWorkloadAssignment','apiDeleteTeamWorkloadAssignment',
  'apiSaveProcurementItem','apiDeleteProcurementItem'
];
for (const name of functions) {
  test(name + ' serializes authorization, record mutation, and audit', () => {
    const body = bodyFor(name);
    const lock = body.indexOf('LockService.getScriptLock()');
    const wait = body.indexOf('lock.waitLock(15000)');
    const auth = body.indexOf('assertPermission_(');
    const mutation = Math.min(...['updateRecordById_','insertRecord_','deleteRow('].map(x => body.indexOf(x)).filter(x => x >= 0));
    const audit = body.indexOf('writeAuditLog_(');
    const release = body.lastIndexOf('lock.releaseLock()');
    assert.ok(lock >= 0 && wait > lock, 'lock acquisition');
    assert.ok(auth > wait, 'permission check occurs inside lock');
    assert.ok(mutation > auth, 'mutation follows authorization');
    assert.ok(audit > mutation, 'audit follows mutation');
    assert.ok(release > audit, 'release follows audit');
    assert.match(body, /finally\s*\{[\s\S]*?lock\.releaseLock\(\);?\s*\}/, 'guaranteed release');
  });
}
