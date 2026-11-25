'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name + ' must exist in Code.gs');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Unterminated function: ' + name);
}

test('project-controls endpoint is syntactically valid and read-only', () => {
  const fn = extractFunction('apiGetProjectControlsInputs');
  assert.doesNotThrow(() => new Function(fn));
  assert.match(fn, /assertPermission_\('Projects', 'view', pid\)/);
  assert.doesNotMatch(fn, /insertRecord_|updateRecordById_|deleteRecordById_|writeAuditLog_/);
});

test('project-controls endpoint independently gates every module dataset', () => {
  const fn = extractFunction('apiGetProjectControlsInputs');
  for (const moduleName of ['WBS_Schedule', 'Milestones', 'Risks', 'Issues', 'Financial_Monitoring']) {
    assert.ok(fn.includes("canView('" + moduleName + "')"), 'missing permission gate: ' + moduleName);
  }
  for (const tabName of ['ACTIVITIES', 'DEPENDENCIES', 'BASELINES', 'MILESTONES', 'RISKS', 'ISSUES', 'FINANCIAL']) {
    assert.ok(fn.includes('DB_CONFIG.TABS.' + tabName), 'missing scoped dataset: ' + tabName);
  }
  assert.match(fn, /String\(row\.Project_ID \|\| ''\)\.trim\(\) === pid/);
  assert.match(fn, /if \(!permitted\) return null/);
  assert.match(fn, /key !== '_rowIndex'/);
});

test('project-controls endpoint denies inaccessible projects before reading datasets', () => {
  const fn = extractFunction('apiGetProjectControlsInputs');
  const projectGate = fn.indexOf("assertPermission_('Projects', 'view', pid)");
  const firstRead = fn.indexOf('readRows(DB_CONFIG.TABS.');
  assert.ok(projectGate >= 0 && firstRead > projectGate);
  assert.match(fn, /Project not found or archived/);
});
