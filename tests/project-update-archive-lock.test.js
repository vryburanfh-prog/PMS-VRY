const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
function fn(name, next) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + next + '(', start + 10);
  assert.ok(start >= 0 && end > start, name + ' exists');
  return source.slice(start, end);
}

test('project register update and archive/restore are serialized', () => {
  const update = fn('apiUpdateProject', 'apiArchiveProject');
  const archive = fn('apiArchiveProject', 'apiGetProjectWbsAndSchedule');
  for (const [name, body] of [['apiUpdateProject', update], ['apiArchiveProject', archive]]) {
    const lock = body.indexOf('lock.waitLock(15000)');
    const release = body.indexOf('lock.releaseLock()');
    assert.ok(lock >= 0 && release > lock, name + ' lock ordering');
    assert.match(body, /finally\s*\{\s*lock\.releaseLock\(\)/, name + ' finally releases lock');
  }
  const updateRecord = update.indexOf("updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', projectId");
  const updateAudit = update.indexOf("writeAuditLog_(ctx, 'UPDATE_PROJECT'");
  assert.ok(updateRecord > update.indexOf('lock.waitLock(15000)') && updateAudit > updateRecord);
  const archiveRecord = archive.indexOf("updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', projectId");
  const archiveAudit = archive.indexOf("writeAuditLog_(");
  assert.ok(archiveRecord > archive.indexOf('lock.waitLock(15000)') && archiveAudit > archiveRecord);
});
