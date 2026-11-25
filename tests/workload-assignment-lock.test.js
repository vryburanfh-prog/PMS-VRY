const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiSaveTeamWorkloadAssignment(projectId, payload)');
const end = source.indexOf('function apiDeleteTeamWorkloadAssignment(', start);
assert.ok(start >= 0 && end > start, 'workload save function exists');
const fn = source.slice(start, end);

test('workload assignment read, ID allocation, mutation, and audit are locked', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const existing = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', rawId)");
  const permission = fn.indexOf("assertPermission_('Team_Workload'");
  const id = fn.indexOf("generateNextId_(DB_CONFIG.TABS.TEAM_WORKLOAD");
  const update = fn.indexOf("updateRecordById_(DB_CONFIG.TABS.TEAM_WORKLOAD");
  const insert = fn.indexOf("insertRecord_(DB_CONFIG.TABS.TEAM_WORKLOAD");
  const updateAudit = fn.indexOf("writeAuditLog_(ctx, 'UPDATE_TEAM_WORKLOAD");
  const insertAudit = fn.indexOf("writeAuditLog_(ctx, 'CREATE_TEAM_WORKLOAD");
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && existing > lock && permission > existing && id > permission);
  assert.ok(update > lock && insert > lock && updateAudit > update && insertAudit > insert && release > updateAudit && release > insertAudit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
