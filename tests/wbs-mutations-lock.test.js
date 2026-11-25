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
const specs = [
  ['apiSaveMainWbs', 'apiSaveSubWbs'],
  ['apiSaveSubWbs', 'apiSaveProjectWbsDepth'],
  ['apiSaveActivity', 'apiQuickUpdateGanttActivity'],
  ['apiQuickUpdateGanttActivity', 'apiSaveProjectControlRecord'],
  ['apiSetWbsRecordArchived', 'apiDeleteWbsRecord'],
  ['apiDeleteWbsRecord', 'apiSaveMainWbs']
];

test('WBS and schedule mutation endpoints consistently acquire and release ScriptLock', () => {
  for (const [name, next] of specs) {
    const fn = getFn(name, next);
    assert.ok(fn.indexOf('lock.waitLock(15000)') >= 0, name + ' acquires lock');
    assert.ok(fn.indexOf('lock.releaseLock()') > fn.indexOf('lock.waitLock(15000)'), name + ' releases lock after acquisition');
    assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/, name + ' releases lock in finally');
  }
});

test('WBS code uniqueness checks and generated IDs occur inside locked save functions', () => {
  for (const [name, next] of specs.slice(0, 3)) {
    const fn = getFn(name, next);
    const lock = fn.indexOf('lock.waitLock(15000)');
    const idGeneration = fn.indexOf('generateNextId_(');
    assert.ok(lock >= 0 && idGeneration > lock, name + ' generates ID while locked');
  }
  const main = getFn('apiSaveMainWbs', 'apiSaveSubWbs');
  const sub = getFn('apiSaveSubWbs', 'apiSaveProjectWbsDepth');
  assert.ok(main.indexOf('Duplicate Main WBS Code') > main.indexOf('lock.waitLock(15000)'));
  assert.ok(sub.indexOf('Duplicate Sub WBS Code') > sub.indexOf('lock.waitLock(15000)'));
});
