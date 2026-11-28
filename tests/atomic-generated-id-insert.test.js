const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Database.gs'), 'utf8');
const start = source.indexOf('function insertRecordWithGeneratedId_(');
const end = source.indexOf('\nfunction ', start + 1);
assert.notEqual(start, -1, 'atomic generated-ID insert helper must exist');
const helperSource = source.slice(start, end === -1 ? source.length : end);

function harness(existingIds, failWrite) {
  const headers = ['Name', 'Project_ID', 'Baseline_ID', 'Remarks'];
  const rows = [headers, ...existingIds.map(id => ['existing', 'P-1', id, ''])];
  const events = [];
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length,
    getRange(row, col, numRows, numCols) {
      events.push('read:' + row + ':' + col);
      return {
        getValues() {
          if (row === 1) return [headers.slice(col - 1, col - 1 + numCols)];
          return rows.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols));
        },
        setValues(values) {
          events.push('write');
          if (failWrite) throw new Error('mock write failure');
          rows.push(values[0]);
        }
      };
    }
  };
  const lock = { waitLock: ms => events.push('lock:' + ms), releaseLock: () => events.push('unlock') };
  const sandbox = {
    LockService: { getScriptLock: () => lock },
    getMasterSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    invalidateTableCache_: tab => events.push('invalidate:' + tab),
    String, Math, RegExp, Set, Error
  };
  const fn = vm.runInNewContext('(' + helperSource + ')', sandbox);
  return { fn, rows, events };
}

test('generated ID and row insertion are performed under one lock; header mapping and collision retry work', () => {
  const h = harness(['BL-001', 'BL-002'], false);
  const record = { Name: 'Baseline', Project_ID: 'P-1', Remarks: 'test' };
  const id = h.fn('Project_Baselines', 'Baseline_ID', 'BL', 3, record);
  assert.equal(id, 'BL-003');
  assert.equal(record.Baseline_ID, id);
  assert.deepEqual(Array.from(h.rows.at(-1)), ['Baseline', 'P-1', 'BL-003', 'test']);
  const lockAt = h.events.indexOf('lock:10000');
  const readAt = h.events.findIndex(e => e.startsWith('read:'));
  const writeAt = h.events.indexOf('write');
  const unlockAt = h.events.indexOf('unlock');
  const invalidateAt = h.events.indexOf('invalidate:Project_Baselines');
  assert.ok(lockAt >= 0 && lockAt < readAt && readAt < writeAt && writeAt < unlockAt);
  assert.ok(writeAt < invalidateAt && invalidateAt < unlockAt);
});

test('lock is released when insertion fails', () => {
  const h = harness([], true);
  assert.throws(() => h.fn('Project_Baselines', 'Baseline_ID', 'BL', 3, { Project_ID: 'P-1' }), /mock write failure/);
  assert.ok(h.events.includes('unlock'));
  assert.ok(!h.events.includes('invalidate:Project_Baselines'));
});

test('helper rejects a missing ID column before attempting a write and releases lock', () => {
  const h = harness([], false);
  assert.throws(() => h.fn('Project_Baselines', 'Missing_ID', 'BL', 3, {}), /Column "Missing_ID" not found/);
  assert.ok(h.events.includes('unlock'));
  assert.ok(!h.events.includes('write'));
});


test('user creation uses atomic generated-ID insert rather than split ID generation and append', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiCreateUser(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.match(fn, /insertRecordWithGeneratedId_\(DB_CONFIG\.TABS\.USERS, 'User_ID', 'USR', 3, newUser\)/);
  assert.doesNotMatch(fn, /generateNextId_\(DB_CONFIG\.TABS\.USERS/);
});


test('weekly report create path uses atomic ID allocation while update path remains unchanged', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveWeeklyReport(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', 'WKR', 4, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.WEEKLY_REPORTS"));
  assert.ok(fn.includes("updateRecordById_(DB_CONFIG.TABS.WEEKLY_REPORTS"));
});

test('team workload create path uses atomic ID allocation and preserves update path', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveTeamWorkloadAssignment(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', 'WASG', 4, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.TEAM_WORKLOAD"));
  assert.ok(fn.includes("updateRecordById_(DB_CONFIG.TABS.TEAM_WORKLOAD"));
});


test('procurement create path uses atomic ID insert while edit path stays intact', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveProcurementItem(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(procTab, 'Procurement_ID', 'PRC', 4, record)"));
  assert.ok(!fn.includes("generateNextId_(procTab"));
  assert.ok(fn.includes("updateRecordById_(procTab, 'Procurement_ID'"));
});


test('financial item create path uses atomic ID insert and keeps update path', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveFinancialItem(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(finTab, 'Financial_ID', 'FIN', 4, record)"));
  assert.ok(!fn.includes("generateNextId_(finTab"));
  assert.ok(fn.includes("updateRecordById_(finTab, 'Financial_ID'"));
});


test('progress log create path uses atomic ID insert and keeps update behavior', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveProgressLog(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', 'LOG', 4, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.PROGRESS_UPDATES"));
  assert.ok(fn.includes("updateRecordById_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID'"));
});


test('Main WBS create path uses atomic generated ID insert and retains edit path', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveMainWbs(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', 'MWBS', 3, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.MAIN_WBS"));
  assert.ok(fn.includes("updateRecordById_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID'"));
});


test('Sub WBS create path uses atomic generated ID insert and retains edit path', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveSubWbs(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', 'SWBS', 3, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.SUB_WBS"));
  assert.ok(fn.includes("updateRecordById_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID'"));
});


test('project-control registry create path uses configured atomic ID helper and update remains intact', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveProjectControlRecord(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(cfg.tab, cfg.idCol, cfg.prefix, cfg.pad, cleanRecord)"));
  assert.ok(!fn.includes("generateNextId_(cfg.tab"));
  assert.ok(fn.includes("updateRecordById_(cfg.tab, cfg.idCol, recordId, cleanRecord)"));
});


test('activity create path uses atomic ID insert while existing activity update path remains intact', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveActivity(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', 'ACT', 4, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID'"));
  assert.ok(fn.includes("updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID'"));
});


test('activity dependency creation uses atomic ID insert', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiSaveActivity(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', 'DEP', 4, dependencyRecord)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.DEPENDENCIES"));
  assert.ok(fn.includes("Dependency_ID: '', Project_ID: record.Project_ID"));
});


test('project creator assignment uses atomic generated-ID insert', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiCreateProject(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', 'ASG', 4, assignmentRecord)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS"));
  assert.ok(fn.includes("Assignment_ID: '',"));
});


test('provided-ID insert helper checks duplicates and appends under a single script lock', () => {
  const dbSource = fs.readFileSync(path.join(__dirname, '..', 'Database.gs'), 'utf8');
  const start = dbSource.indexOf('function insertRecordWithProvidedId_(');
  const end = dbSource.indexOf('\nfunction ', start + 1);
  assert.notEqual(start, -1);
  const helper = dbSource.slice(start, end < 0 ? dbSource.length : end);
  // Isolated mock sheet for the caller-supplied-ID helper.
  const headers = ['Name','Project_ID','Baseline_ID','Remarks'];
  const rows = [headers,['existing','P-1','BL-001','']];
  const sheet = {getLastColumn:()=>headers.length,getLastRow:()=>rows.length,getRange(row,col,numRows,numCols){return {getValues:()=>row===1?[headers.slice(col-1,col-1+numCols)]:rows.slice(row-1,row-1+numRows).map(r=>r.slice(col-1,col-1+numCols)),setValues:v=>rows.push(v[0])};}};
  const testEvents=[];
  const fn2=vm.runInNewContext('('+helper+')',{LockService:{getScriptLock:()=>({waitLock:ms=>testEvents.push('lock'),releaseLock:()=>testEvents.push('unlock')})},getMasterSpreadsheet_:()=>({getSheetByName:()=>sheet}),invalidateTableCache_:()=>testEvents.push('invalidate'),String,Error});
  const record={Name:'Caller ID record',Project_ID:'P-1',Remarks:'manual'};
  assert.equal(fn2('Project_Baselines','Baseline_ID','BL-002',record),'BL-002');
  assert.equal(record.Baseline_ID,'BL-002');
  assert.deepEqual(rows.at(-1),['Caller ID record','P-1','BL-002','manual']);
  assert.ok(testEvents.indexOf('lock') < testEvents.indexOf('invalidate'));
  assert.ok(testEvents.includes('unlock'));
  assert.throws(()=>fn2('Project_Baselines','Baseline_ID','BL-001',{}),/Duplicate ID/);
});

test('project creation uses atomic insert for generated IDs and locked duplicate-check insert for caller IDs', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const start = code.indexOf('function apiCreateProject(');
  const end = code.indexOf('\nfunction ', start + 1);
  const fn = code.slice(start, end < 0 ? code.length : end);
  assert.ok(fn.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', 'PRJ', 3, record)"));
  assert.ok(fn.includes("insertRecordWithProvidedId_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId, record)"));
  assert.ok(!fn.includes("generateNextId_(DB_CONFIG.TABS.PROJECTS"));
});


test('generated-ID inventory gate: no active legacy allocator call sites in Code.gs or Security.gs', () => {
  for (const file of ['Code.gs', 'Security.gs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const matches = source.match(/generateNextId_\s*\(/g) || [];
    assert.equal(matches.length, 0, file + ' must not call the legacy unlocked allocator.');
  }
});



test('Security generated-ID creation paths use atomic insert helpers', () => {
  const security = fs.readFileSync(path.join(__dirname, '..', 'Security.gs'), 'utf8');
  assert.ok(security.includes("insertRecordWithGeneratedId_(tabName, 'Permission_ID', 'PRM', 4, values)"));
  assert.ok(security.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', 'CRD', 5, credentialRecord)"));
  assert.equal((security.match(/insertRecordWithGeneratedId_\(DB_CONFIG\.TABS\.AUTH_SESSIONS, 'Session_ID', 'SES', 6, sessionRecord\)/g) || []).length, 2);
  assert.ok(security.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUDIT_LOGS, 'Audit_ID', 'AUD', 5, auditRecord)"));
  assert.ok(security.includes("Credential_ID: ''"));
  assert.ok(security.includes("Session_ID:''"));
  assert.ok(security.includes("Audit_ID: ''"));
  assert.ok(security.includes("values.Permission_ID = ''"));
});
