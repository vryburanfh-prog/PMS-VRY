const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiDeleteTeamWorkloadAssignment(projectId, assignmentId)');
const end = source.indexOf('// PHASE 10: PROCUREMENT', start);
assert.ok(start >= 0 && end > start, 'workload deletion function exists');
const fn = source.slice(start, end);

test('workload assignment ownership check, row delete, and audit are locked', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const permission = fn.indexOf("assertPermission_('Team_Workload', 'delete'");
  const lookup = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', assignmentId)");
  const deleteRow = fn.indexOf('sheet.deleteRow(existing._rowIndex)');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'DELETE_TEAM_WORKLOAD'");
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && permission > lock && lookup > permission && deleteRow > lookup && audit > deleteRow && release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
