'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

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


test('portfolio controls endpoint derives projects from the authorized portfolio API', () => {
  const fn = extractFunction('apiGetPortfolioControlsSummary');
  assert.doesNotThrow(() => new Function(fn));
  assert.match(fn, /apiGetPortfolioData\(filters \|\| \{\}\)/);
  assert.match(fn, /ids\.has\(id\)/);
  assert.match(fn, /canView\('Risks'\)/);
  assert.match(fn, /canView\('Issues'\)/);
  assert.match(fn, /canView\('Milestones'\)/);
  assert.match(fn, /canView\('WBS_Schedule'\)/);
  assert.match(fn, /canView\('Financial_Monitoring'\)/);
  assert.doesNotMatch(fn, /insertRecord_|updateRecordById_|deleteRecordById_|writeAuditLog_/);
});

test('portfolio controls endpoint returns aggregate indicators, not source records', () => {
  const fn = extractFunction('apiGetPortfolioControlsSummary');
  for (const key of ['criticalRisks', 'openIssues', 'overdueMilestones', 'delayedActivities', 'projectsOverBudget', 'projectsOverCommitted']) {
    assert.ok(fn.includes(key), 'missing portfolio indicator: ' + key);
  }
  assert.match(fn, /return \{\s*success: true/);
  assert.match(fn, /availability:/);
});

test('project-controls endpoint denies inaccessible projects before reading datasets', () => {
  const fn = extractFunction('apiGetProjectControlsInputs');
  const projectGate = fn.indexOf("assertPermission_('Projects', 'view', pid)");
  const firstRead = fn.indexOf('readRows(DB_CONFIG.TABS.');
  assert.ok(projectGate >= 0 && firstRead > projectGate);
  assert.match(fn, /Project not found or archived/);
});


test('portfolio dashboard renders and refreshes the project-controls watchlist', () => {
  assert.match(indexSource, /id="project-controls-kpi-grid"/);
  assert.match(indexSource, /function renderProjectControlsKPIs\(data\)/);
  assert.match(indexSource, /\.apiGetPortfolioControlsSummary\(\{ includeArchived: includeArchived \}\)/);
  for (const label of ['High / Critical Risks', 'Open Issues', 'Overdue Milestones', 'Delayed Activities', 'Projects Over Budget', 'Projects Over-committed']) {
    assert.ok(indexSource.includes(label), 'missing watchlist KPI: ' + label);
  }
});
