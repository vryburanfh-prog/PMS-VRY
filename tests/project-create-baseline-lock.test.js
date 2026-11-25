const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync('Code.gs', 'utf8');

function extract(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, name + ' exists');
  return source.slice(start, end);
}

test('project creation locks ID uniqueness, project insert, assignment ID and assignment insert', () => {
  const fn = extract('apiCreateProject', 'apiUpdateProject');
  const lock = fn.indexOf('lock.waitLock(15000)');
  const projectId = fn.indexOf('generateNextId_(DB_CONFIG.TABS.PROJECTS');
  const duplicateCheck = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.PROJECTS");
  const projectInsert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.PROJECTS, record)');
  const assignmentId = fn.indexOf("generateNextId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS");
  const assignmentInsert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'CREATE_PROJECT'");
  assert.ok(lock >= 0 && projectId > lock && duplicateCheck > lock && projectInsert > lock);
  assert.ok(assignmentId > projectInsert && assignmentInsert > assignmentId && audit > assignmentInsert);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});

test('baseline creation locks revision calculation, snapshot, insert, and audit', () => {
  const fn = extract('apiCreateProjectBaseline', 'apiRecalculateProjectProgress');
  const lock = fn.indexOf('lock.waitLock(15000)');
  const revisions = fn.indexOf('existingBaselines.reduce');
  const baselineId = fn.indexOf("generateNextId_(DB_CONFIG.TABS.BASELINES");
  const snapshot = fn.indexOf('const snapshot =');
  const insert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.BASELINES');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'CREATE_BASELINE'");
  assert.ok(lock >= 0 && revisions > lock && baselineId > lock);
  assert.ok(snapshot > lock && insert > snapshot && audit > insert);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});
