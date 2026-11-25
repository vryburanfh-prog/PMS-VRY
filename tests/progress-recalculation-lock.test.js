const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiRecalculateWeightedProgress(projectId, newProgressMethod)');
const end = source.indexOf('function apiQuickUpdateGanttActivity(', start);
assert.ok(start >= 0 && end > start, 'weighted progress recalculation function exists');
const fn = source.slice(start, end);

test('progress method change, roll-up calculation, and audit are serialized', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const methodUpdate = fn.indexOf("updateRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', pid");
  const recalc = fn.indexOf('recalculateProjectProgressEngine_(pid)');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'RECALCULATE_PROGRESS'");
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && methodUpdate > lock && recalc > lock && audit > recalc && release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
