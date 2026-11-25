const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
function getFn(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + nextName + '(', start + 10);
  assert.ok(start >= 0 && end > start, name + ' exists');
  return source.slice(start, end);
}
const saves = [
  ['apiSaveProgressLog', 'apiReviewProgressLog'],
  ['apiSaveWeeklyReport', 'apiDeleteWeeklyReport']
];
const mutations = [
  ['apiSaveProgressLog', 'apiReviewProgressLog'],
  ['apiReviewProgressLog', 'apiSaveWeeklyReport'],
  ['apiSaveWeeklyReport', 'apiDeleteWeeklyReport'],
  ['apiDeleteWeeklyReport', 'apiGetSnapshotsAndTemplatesData']
];

test('progress and weekly report mutation endpoints acquire and release ScriptLock', () => {
  for (const [name, next] of mutations) {
    const fn = getFn(name, next);
    const lock = fn.indexOf('lock.waitLock(15000)');
    const release = fn.indexOf('lock.releaseLock()');
    assert.ok(lock >= 0 && release > lock, name + ' lock ordering');
    assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/, name + ' lock release in finally');
  }
});

test('progress log and weekly report generated IDs and inserts are locked', () => {
  const progress = getFn('apiSaveProgressLog', 'apiReviewProgressLog');
  const pLock = progress.indexOf('lock.waitLock(15000)');
  const pId = progress.indexOf('generateNextId_(');
  const pInsert = progress.indexOf('insertRecord_(');
  assert.ok(pLock >= 0 && pId > pLock && pInsert > pId);
  const report = getFn('apiSaveWeeklyReport', 'apiDeleteWeeklyReport');
  const rLock = report.indexOf('lock.waitLock(15000)');
  const rId = report.indexOf("generateNextId_(DB_CONFIG.TABS.WEEKLY_REPORTS");
  const rInsert = report.indexOf('insertRecord_(');
  assert.ok(rLock >= 0 && rId > rLock && rInsert > rId);
});
