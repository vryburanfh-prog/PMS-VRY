const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiCreateProject(payload)');
const end = source.indexOf('function apiUpdateProject(', start);
assert.ok(start >= 0 && end > start, 'apiCreateProject exists');
const fn = source.slice(start, end);

test('project and creator assignment creation are serialized', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const duplicateCheck = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId)");
  const projectInsert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.PROJECTS, record)');
  const assignmentId = fn.indexOf("generateNextId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS");
  const assignmentInsert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS');
  const audit = fn.indexOf("writeAuditLog_(ctx, 'CREATE_PROJECT'");
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && duplicateCheck > lock);
  assert.ok(projectInsert > lock && assignmentId > projectInsert && assignmentInsert > assignmentId);
  assert.ok(audit > assignmentInsert && release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});

test('project ID generation and duplicate validation happen under the lock', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const generatedId = fn.indexOf("generateNextId_(DB_CONFIG.TABS.PROJECTS");
  const duplicateCheck = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId)");
  assert.ok(lock >= 0 && generatedId > lock && duplicateCheck > generatedId);
});

test('project creation compensates partial writes and treats audit failure as warning', () => {
  const creationCatch = fn.indexOf('catch (creationError)');
  const assignmentCleanup = fn.indexOf("deleteRecordsByIds_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS", creationCatch);
  const projectCleanup = fn.indexOf("deleteRecordsByIds_(DB_CONFIG.TABS.PROJECTS", creationCatch);
  const audit = fn.indexOf("writeAuditLog_(ctx, 'CREATE_PROJECT'");
  assert.ok(creationCatch > 0 && assignmentCleanup > creationCatch && projectCleanup > assignmentCleanup);
  assert.ok(audit > projectCleanup);
  assert.match(fn, /Project was created successfully, but audit logging failed/);
  assert.match(fn, /return \{ success: true, project: record, warning: auditWarning \}/);
});
