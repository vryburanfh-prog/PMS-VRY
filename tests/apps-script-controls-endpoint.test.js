'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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


function runProjectControlsEndpoint(options) {
  const opts = options || {};
  const fn = extractFunction('apiGetProjectControlsInputs');
  const reads = [];
  const tabs = {
    PROJECTS: 'Projects', ACTIVITIES: 'Activities', DEPENDENCIES: 'Dependencies',
    BASELINES: 'Baselines', MILESTONES: 'Milestones', RISKS: 'Risks',
    ISSUES: 'Issues', FINANCIAL: 'Financial'
  };
  const datasets = opts.datasets || {};
  const context = {
    DB_CONFIG: { TABS: tabs },
    assertPermission_: function (moduleName, action, projectId) {
      if (opts.denyProject) throw new Error('Permission denied');
      assert.equal(moduleName, 'Projects');
      assert.equal(action, 'view');
      assert.equal(projectId, opts.expectedProjectId || 'P-1');
      return opts.context || { isAdmin: false, permissions: {} };
    },
    findRecordRowById_: function (tab, key, id) {
      assert.equal(tab, 'Projects');
      assert.equal(key, 'Project_ID');
      return (datasets.Projects || []).find(row => String(row.Project_ID) === String(id)) || null;
    },
    isTruthySheetFlag_: function (value) {
      return value === true || ['true', 'yes', '1'].includes(String(value || '').toLowerCase());
    },
    getTableRecords_: function (tab) { reads.push(tab); return datasets[tab] || []; },
    Utilities: { formatDate: () => '2026-11-25' }
  };
  return { result: vm.runInNewContext('(' + fn + ')', context)(opts.projectId || 'P-1'), reads };
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



test('runtime: project endpoint scopes every returned dataset and strips internal row metadata', () => {
  const rows = { Projects: [{ Project_ID: 'P-1', Project_Name: 'Alpha', Is_Archived: false }] };
  for (const tab of ['Activities','Dependencies','Baselines','Milestones','Risks','Issues','Financial']) {
    rows[tab] = [
      { Project_ID: 'P-1', Record_ID: tab + '-1', Is_Archived: false, _rowIndex: 9 },
      { Project_ID: 'P-2', Record_ID: tab + '-2', Is_Archived: false, _rowIndex: 10 }
    ];
  }
  const { result } = runProjectControlsEndpoint({ datasets: rows, context: { isAdmin: true, permissions: {} } });
  assert.equal(result.success, true);
  for (const key of ['activities','dependencies','baselines','milestones','risks','issues','financialItems']) {
    assert.equal(result[key].length, 1, key + ' must be project scoped');
    assert.equal(result[key][0]._rowIndex, undefined);
  }
});

test('runtime: denied module permissions return null without reading that module', () => {
  const rows = { Projects: [{ Project_ID: 'P-1', Project_Name: 'Alpha' }], Activities: [{ Project_ID: 'P-1' }] };
  const { result, reads } = runProjectControlsEndpoint({ datasets: rows, context: { isAdmin: false, permissions: { WBS_Schedule: { view: true } } } });
  assert.equal(JSON.stringify(result.access), JSON.stringify({ schedule: true, milestones: false, risks: false, issues: false, financialMonitoring: false }));
  assert.equal(result.activities.length, 1);
  for (const key of ['milestones','risks','issues','financialItems']) assert.equal(result[key], null);
  assert.ok(!reads.includes('Milestones') && !reads.includes('Risks') && !reads.includes('Issues') && !reads.includes('Financial'));
});

test('runtime: archived rows and archived projects are excluded', () => {
  const rows = {
    Projects: [{ Project_ID: 'P-1', Project_Name: 'Alpha', Is_Archived: false }],
    Activities: [{ Project_ID: 'P-1', Is_Archived: false }, { Project_ID: 'P-1', Is_Archived: true }],
    Milestones: [{ Project_ID: 'P-1', Is_Archived: true }]
  };
  const { result } = runProjectControlsEndpoint({ datasets: rows, context: { isAdmin: true, permissions: {} } });
  assert.equal(result.activities.length, 1);
  assert.equal(result.milestones.length, 0);
  assert.throws(() => runProjectControlsEndpoint({
    datasets: { Projects: [{ Project_ID: 'P-1', Is_Archived: true }] },
    context: { isAdmin: true, permissions: {} }
  }), /Project not found or archived/);
});

test('runtime: rejects blank IDs and stops before any module reads when project access is denied', () => {
  assert.throws(() => runProjectControlsEndpoint({ projectId: '   ' }), /Project_ID is required/);
  const rows = { Projects: [{ Project_ID: 'P-1', Is_Archived: false }] };
  assert.throws(() => runProjectControlsEndpoint({ datasets: rows, denyProject: true }), /Permission denied/);
});

test('portfolio controls endpoint derives projects from the authorized portfolio API', () => {
  const fn = extractFunction('apiGetPortfolioControlsSummary');
  assert.doesNotThrow(() => new Function(fn));
  assert.match(fn, /apiGetPortfolioData\(filters \|\| \{\}\)/);
  assert.match(fn, /ids\.has\(id\)/);
  assert.match(fn, /readScoped\(DB_CONFIG\.TABS\.RISKS, 'Risks'/);
  assert.match(fn, /readScoped\(DB_CONFIG\.TABS\.ISSUES, 'Issues'/);
  assert.match(fn, /readScoped\(DB_CONFIG\.TABS\.MILESTONES, 'Milestones'/);
  assert.match(fn, /readScoped\(DB_CONFIG\.TABS\.ACTIVITIES, 'WBS_Schedule'/);
  assert.match(fn, /readScoped\(DB_CONFIG\.TABS\.FINANCIAL, 'Financial_Monitoring'/);
  assert.doesNotMatch(fn, /insertRecord_|updateRecordById_|deleteRecordById_|writeAuditLog_/);
  assert.doesNotMatch(fn, /canViewRisks|canViewIssues/);
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
  assert.match(indexSource, /id="project-controls-project-rows"/);
  assert.match(indexSource, /Array\.isArray\(data\.projects\)/);
  assert.match(indexSource, /function renderProjectControlsKPIs\(data\)/);
  assert.match(indexSource, /\.apiGetPortfolioControlsSummary\(\{ includeArchived: includeArchived \}\)/);
  for (const label of ['High / Critical Risks', 'Open Issues', 'Overdue Milestones', 'Delayed Activities', 'Projects Over Budget', 'Projects Over-committed']) {
    assert.ok(indexSource.includes(label), 'missing watchlist KPI: ' + label);
  }
});


test('portfolio watchlist opens a permission-aware project controls drill-down', () => {
  assert.match(indexSource, /openProjectControlsDrilldown_\(/);
  assert.match(indexSource, /apiGetProjectControlsInputs\(pid\)/);
  assert.match(indexSource, /ensureProjectControlsDrilldown_/);
  assert.match(indexSource, /res\.access\.financialMonitoring/);
  assert.match(indexSource, /Restricted/);
  assert.match(indexSource, /Counts reflect records visible to your account/);
  assert.match(indexSource, /escapeHtmlSafe_\(project\.Project_Name/);
  assert.match(indexSource, /activeProjectControlsDrilldownId_ !== pid/);
  assert.match(indexSource, /activeProjectControlsDrilldownId_ = null/);
});

test('legacy portfolio KPI response hides module metrics without view permission', () => {
  assert.match(source, /const canViewMilestones = Boolean\(ctx\.isAdmin \|\|/);
  assert.match(source, /const canViewRisks = Boolean\(ctx\.isAdmin \|\|/);
  assert.match(source, /const canViewIssues = Boolean\(ctx\.isAdmin \|\|/);
  assert.match(source, /delayedMilestones: canViewMilestones \? delayedMilestones : null/);
  assert.match(source, /criticalRisks: canViewRisks \? criticalRisks : null/);
  assert.match(source, /openIssues: canViewIssues \? openIssues : null/);
  assert.match(indexSource, /k\.criticalRisks == null \? '—'/);
  assert.match(indexSource, /k\.openIssues == null \? '—'/);
});



function runPortfolioControlsSummary(options) {
  const opts = options || {};
  const fn = extractFunction('apiGetPortfolioControlsSummary');
  const reads = [];
  const tabs = {
    RISKS: 'Risks', ISSUES: 'Issues', MILESTONES: 'Milestones',
    ACTIVITIES: 'Activities', FINANCIAL: 'Financial'
  };
  const context = {
    DB_CONFIG: { TABS: tabs },
    apiGetPortfolioData: function (filters) {
      assert.deepEqual(JSON.parse(JSON.stringify(filters)), opts.filters || {});
      return { context: opts.context || { isAdmin: false, permissions: {} }, projects: opts.projects || [] };
    },
    getTableRecords_: function (tab) { reads.push(tab); return (opts.datasets || {})[tab] || []; },
    isTruthySheetFlag_: function (value) {
      return value === true || ['true', 'yes', '1'].includes(String(value || '').toLowerCase());
    },
    Utilities: { formatDate: () => opts.today || '2026-11-25' },
    Date
  };
  return { result: vm.runInNewContext('(' + fn + ')', context)(opts.filters || {}), reads };
}

test('runtime: portfolio summary only reads authorized modules and scopes rows to authorized portfolio projects', () => {
  const projects = [{ Project_ID: 'P-1', Project_Name: 'Alpha' }];
  const datasets = {
    Risks: [
      { Project_ID: 'P-1', Risk_Rating: '10 - High', Current_Status: 'Open' },
      { Project_ID: 'P-1', Risk_Rating: '15 - Critical', Current_Status: 'Closed' },
      { Project_ID: 'P-2', Risk_Rating: '15 - Critical', Current_Status: 'Open' }
    ],
    Issues: [{ Project_ID: 'P-1', Issue_Status: 'Open' }, { Project_ID: 'P-2', Issue_Status: 'Open' }],
    Milestones: [{ Project_ID: 'P-1', Milestone_Status: 'In Progress', Forecast_Date: '2026-11-24' }],
    Activities: [{ Project_ID: 'P-1', Status: 'In Progress', Forecast_Finish_Date: '2026-11-20' }],
    Financial: [{ Project_ID: 'P-1', Budget_Amount: 100, Committed_Amount: 120, Actual_Spend: 110 }]
  };
  const permissions = Object.fromEntries(['Risks','Issues','Milestones','WBS_Schedule','Financial_Monitoring'].map(k => [k, { view: true }]));
  const { result, reads } = runPortfolioControlsSummary({ projects, datasets, context: { isAdmin: false, permissions }, filters: { includeArchived: false } });
  assert.deepEqual(reads, ['Risks','Issues','Milestones','Activities','Financial']);
  assert.equal(result.projectCount, 1);
  assert.equal(result.criticalRisks, 1);
  assert.equal(result.openIssues, 1);
  assert.equal(result.overdueMilestones, 1);
  assert.equal(result.delayedActivities, 1);
  assert.equal(result.projectsOverBudget, 1);
  assert.equal(result.projectsOverCommitted, 1);
  assert.equal(result.projects[0].projectId, 'P-1');
  assert.equal(JSON.stringify(result).includes('Risk_Rating'), false);
  assert.equal(JSON.stringify(result).includes('Issue_Status'), false);
});

test('runtime: portfolio summary performs no source-tab reads for an empty authorized portfolio', () => {
  const { result, reads } = runPortfolioControlsSummary({ projects: [] });
  assert.equal(result.projectCount, 0);
  assert.deepEqual(reads, []);
});

test('runtime: inaccessible modules are not read and their indicators remain unavailable', () => {
  const projects = [{ Project_ID: 'P-1', Project_Name: 'Alpha' }];
  const { result, reads } = runPortfolioControlsSummary({
    projects,
    context: { isAdmin: false, permissions: { Risks: { view: true } } },
    datasets: { Risks: [{ Project_ID: 'P-1', Risk_Rating: '15 - Critical', Current_Status: 'Open' }] }
  });
  assert.deepEqual(reads, ['Risks']);
  assert.equal(result.criticalRisks, 1);
  for (const key of ['openIssues','overdueMilestones','delayedActivities']) assert.equal(result[key], null);
  assert.equal(result.projects[0].availability.issues, false);
  assert.equal(result.projects[0].overBudget, null);
  assert.equal(result.projectsOverBudget, null);
});

test('runtime: archived records are excluded and financial aggregates remain null without finance rows', () => {
  const projects = [{ Project_ID: 'P-1', Project_Name: 'Alpha' }];
  const permissions = Object.fromEntries(['Risks','Issues','Milestones','WBS_Schedule','Financial_Monitoring'].map(k => [k, { view: true }]));
  const { result } = runPortfolioControlsSummary({
    projects, context: { isAdmin: false, permissions },
    datasets: {
      Risks: [{ Project_ID: 'P-1', Risk_Rating: '15 - Critical', Current_Status: 'Open', Is_Archived: true }],
      Issues: [], Milestones: [], Activities: [], Financial: []
    }
  });
  assert.equal(result.criticalRisks, 0);
  assert.equal(result.openIssues, 0);
  assert.equal(result.overdueMilestones, 0);
  assert.equal(result.delayedActivities, 0);
  assert.equal(result.projects[0].overBudget, null);
  assert.equal(result.projectsOverBudget, null);
});
