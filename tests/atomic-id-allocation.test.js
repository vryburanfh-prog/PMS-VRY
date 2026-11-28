const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = fs.readFileSync(path.join(__dirname, '..', 'Database.gs'), 'utf8');
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const security = fs.readFileSync(path.join(__dirname, '..', 'Security.gs'), 'utf8');
const initialSetup = fs.readFileSync(path.join(__dirname, '..', 'InitialSetup.gs'), 'utf8');
const wbsDiagnostic = fs.readFileSync(path.join(__dirname, '..', 'WbsDiagnostic.gs'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const presentationHtml = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');

function extractHelper() {
  const start = db.indexOf('function insertRecordWithGeneratedId_');
  const end = db.indexOf('function generateNextId_', start);
  assert.ok(start >= 0 && end > start, 'atomic helper boundaries exist');
  return db.slice(start, end);
}

function makeHarness(existingIds = [], failInsert = false) {
  let lockHeld = false, waitCount = 0, releaseCount = 0;
  const records = existingIds.map(id => ({ User_ID: id }));
  const sheet = {
    getLastColumn: () => 1,
    getLastRow: () => records.length + 1,
    getRange: (row, col, rows, cols) => ({
      getValues: () => row === 1 ? [['User_ID']] : records.slice(row - 2, row - 2 + rows).map(r => [r.User_ID])
    })
  };
  const context = {
    LockService: { getScriptLock: () => ({
      hasLock: () => lockHeld,
      waitLock: () => { assert.equal(lockHeld, false, 'lock is not re-entered'); lockHeld = true; waitCount++; },
      releaseLock: () => { assert.equal(lockHeld, true); lockHeld = false; releaseCount++; }
    }) },
    getMasterSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    insertRecord_: (tab, record) => {
      assert.equal(lockHeld, true, 'insert must happen while allocation lock is held');
      if (failInsert) throw new Error('simulated insert failure');
      records.push({ User_ID: record.User_ID });
    }
  };
  vm.createContext(context);
  vm.runInContext(extractHelper(), context);
  return { context, records, stats: () => ({ lockHeld, waitCount, releaseCount }) };
}

test('atomic ID allocation allocates unique sequential IDs and inserts under lock', () => {
  const h = makeHarness(['USR-001', 'USR-009']);
  const r1 = h.context.insertRecordWithGeneratedId_('Users', 'User_ID', 'USR', 3, {});
  const r2 = h.context.insertRecordWithGeneratedId_('Users', 'User_ID', 'USR', 3, {});
  assert.equal(r1.User_ID, 'USR-010');
  assert.equal(r2.User_ID, 'USR-011');
  assert.equal(h.records.length, 4);
  assert.deepEqual(h.stats(), { lockHeld: false, waitCount: 2, releaseCount: 2 });
});

test('atomic helper releases lock if insert throws', () => {
  const h = makeHarness([], true);
  assert.throws(() => h.context.insertRecordWithGeneratedId_('Users', 'User_ID', 'USR', 3, {}), /simulated insert failure/);
  assert.deepEqual(h.stats(), { lockHeld: false, waitCount: 1, releaseCount: 1 });
});

test('user creation uses atomic ID allocation and append helper', () => {
  const api = code.match(/function apiCreateUser[\s\S]*?\r?\n}\r?\n/);
  assert.ok(api, 'apiCreateUser exists');
  assert.match(api[0], /User_ID:\s*''/);
  assert.match(api[0], /insertRecordWithGeneratedId_\(DB_CONFIG\.TABS\.USERS, 'User_ID', 'USR', 3, newUser\)/);
  assert.doesNotMatch(api[0], /generateNextId_\(DB_CONFIG\.TABS\.USERS/);
  assert.ok(api[0].includes('userCreationLock.waitLock(10000)'), 'user and credential creation are serialized');
  assert.ok(api[0].includes('deleteRecordById_(DB_CONFIG.TABS.USERS, \'User_ID\', newUser.User_ID)'), 'user row rolls back if credential creation fails');
});


test('project control registry creates use atomic allocation while updates retain existing IDs', () => {
  const start = code.indexOf('function apiSaveProjectControlRecord');
  const end = code.indexOf('\nfunction apiDeleteProjectControlRecord', start);
  assert.ok(start >= 0 && end > start, 'save and delete API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("cleanRecord[cfg.idCol] = isUpdate ? rawId : '';"));
  assert.ok(api.includes('const recordId = rawId;'), 'update pathway retains the existing ID');
  assert.ok(api.includes('insertRecordWithGeneratedId_(cfg.tab, cfg.idCol, cfg.prefix, cfg.pad, cleanRecord)'));
  assert.ok(!api.includes('generateNextId_(cfg.tab, cfg.idCol'), 'registry create no longer uses non-atomic ID generation');
});


test('project and creator assignment IDs are allocated atomically on project creation', () => {
  const start = code.indexOf('function apiCreateProject');
  const end = code.indexOf('\nfunction apiUpdateProject', start);
  assert.ok(start >= 0 && end > start, 'project create boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', 'PRJ', 3, record)"));
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS, 'Assignment_ID', 'ASG', 4, assignment)"));
  assert.ok(api.includes('projectCreateLock.waitLock(10000)'), 'project and creator assignment writes are serialized');
  assert.ok(api.includes("deleteRecordById_(DB_CONFIG.TABS.PROJECTS, 'Project_ID', newId)"), 'project row rolls back if creator assignment insert fails');
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.PROJECTS"));
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS"));
});


test('schedule activity and predecessor dependency creates use atomic IDs', () => {
  const start = code.indexOf('function apiSaveActivity');
  const end = code.indexOf('\nfunction apiGetGanttAndBaselines', start);
  assert.ok(start >= 0 && end > start, 'activity API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', 'ACT', 4, record)"));
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', 'DEP', 4, dependency)"));
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.ACTIVITIES"));
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.DEPENDENCIES"));
});


test('schedule baseline creation uses atomic ID allocation', () => {
  const start = code.indexOf('function apiCreateProjectBaseline');
  const end = code.indexOf('\nfunction api', start + 10);
  assert.ok(start >= 0 && end > start, 'baseline API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.BASELINES, 'Baseline_ID', 'BL', 3, record, function()"));
  assert.ok(api.includes("invalidateTableCache_(DB_CONFIG.TABS.BASELINES)"), 'baseline revision reads bypass stale cache');
  assert.ok(api.includes("record.Revision_Number = existingBaselines.reduce"), 'revision is calculated inside the atomic callback');
  assert.ok(api.includes("record.Baseline_Name = 'Baseline Rev ' + record.Revision_Number"), 'default revision name is derived under lock');
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.BASELINES"));
});


test('daily progress log creates use atomic ID allocation', () => {
  const start = code.indexOf('function apiSaveProgressLog');
  const end = code.indexOf('\nfunction apiReviewProgressLog', start);
  assert.ok(start >= 0 && end > start, 'progress log API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROGRESS_UPDATES, 'Log_ID', 'LOG', 4, record)"));
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.PROGRESS_UPDATES"));
});


test('weekly report creates use atomic ID allocation', () => {
  const start = code.indexOf('function apiSaveWeeklyReport');
  const end = code.indexOf('\nfunction apiDeleteWeeklyReport', start);
  assert.ok(start >= 0 && end > start, 'weekly report API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', 'WKR', 4, record)"));
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.WEEKLY_REPORTS"));
});


test('team workload assignment creates use atomic ID allocation', () => {
  const start = code.indexOf('function apiSaveTeamWorkloadAssignment');
  const end = code.indexOf('\nfunction apiDeleteTeamWorkloadAssignment', start);
  assert.ok(start >= 0 && end > start, 'workload API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', 'WASG', 4, record)"));
  assert.ok(!api.includes("generateNextId_(DB_CONFIG.TABS.TEAM_WORKLOAD"));
});


test('procurement and financial item creates use atomic ID allocation', () => {
  const procurementStart = code.indexOf('function apiSaveProcurementItem');
  const procurementEnd = code.indexOf('\nfunction apiDeleteProcurementItem', procurementStart);
  assert.ok(procurementStart >= 0 && procurementEnd > procurementStart, 'procurement API boundaries exist');
  const procurement = code.slice(procurementStart, procurementEnd);
  assert.ok(procurement.includes("insertRecordWithGeneratedId_(procTab, 'Procurement_ID', 'PRC', 4, record)"));
  assert.ok(!procurement.includes("generateNextId_(procTab"));

  const financialStart = code.indexOf('function apiSaveFinancialItem');
  const financialEnd = code.indexOf('\nfunction apiDeleteFinancialItem', financialStart);
  assert.ok(financialStart >= 0 && financialEnd > financialStart, 'financial API boundaries exist');
  const financial = code.slice(financialStart, financialEnd);
  assert.ok(financial.includes("insertRecordWithGeneratedId_(finTab, 'Financial_ID', 'FIN', 4, record)"));
  assert.ok(!financial.includes("generateNextId_(finTab"));
});


test('ID allocation callback runs before insertion under lock', () => {
  const h = makeHarness(['USR-003']);
  const r = {};
  h.context.insertRecordWithGeneratedId_('Users', 'User_ID', 'USR', 3, r, (id, record) => {
    assert.equal(id, 'USR-004');
    record.Display_Code = id;
  });
  assert.equal(r.Display_Code, 'USR-004');
  assert.equal(h.records.at(-1).User_ID, 'USR-004');
  assert.deepEqual(h.stats(), { lockHeld: false, waitCount: 1, releaseCount: 1 });
});

test('Main and Sub WBS creates use atomic IDs and derive default WBS codes inside allocation', () => {
  const mainStart = code.indexOf('function apiSaveMainWbs');
  const mainEnd = code.indexOf('\nfunction apiSaveSubWbs', mainStart);
  assert.ok(mainStart >= 0 && mainEnd > mainStart, 'main WBS API boundaries exist');
  const main = code.slice(mainStart, mainEnd);
  assert.ok(main.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.MAIN_WBS, 'Main_WBS_ID', 'MWBS', 3, record, function(id, assignedRecord)"));
  assert.ok(main.includes('wbsUpdateLock.waitLock(10000)'), 'main WBS update uniqueness is serialized');
  assert.ok(main.includes('checkDuplicateMainWbsCode(mainWbsCode, record.Main_WBS_ID)'), 'main WBS update rechecks duplicate codes under lock');
  assert.ok(!main.includes("generateNextId_(DB_CONFIG.TABS.MAIN_WBS"));

  const subStart = code.indexOf('function apiSaveSubWbs');
  const subEnd = code.indexOf('\nfunction apiSaveProjectWbsDepth', subStart);
  assert.ok(subStart >= 0 && subEnd > subStart, 'sub WBS API boundaries exist');
  const sub = code.slice(subStart, subEnd);
  assert.ok(sub.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.SUB_WBS, 'Sub_WBS_ID', 'SWBS', 3, record, function(id, assignedRecord)"));
  assert.ok(sub.includes('wbsUpdateLock.waitLock(10000)'), 'sub WBS update uniqueness is serialized');
  assert.ok(sub.includes('checkDuplicateSubWbsCode(subWbsCode, record.Sub_WBS_ID)'), 'sub WBS update rechecks duplicate codes under lock');
  assert.ok(!sub.includes("generateNextId_(DB_CONFIG.TABS.SUB_WBS"));
});


test('security permission, credential, session, and audit IDs use atomic helper', () => {
  assert.ok(security.includes("insertRecordWithGeneratedId_(tabName, 'Permission_ID', 'PRM', 4, values)"));
  const credentialStart = security.indexOf('function createPasswordCredential_');
  const credentialEnd = security.indexOf('\nfunction findValidAuthSession_', credentialStart);
  assert.ok(credentialStart >= 0 && credentialEnd > credentialStart, 'credential function boundaries exist');
  const credential = security.slice(credentialStart, credentialEnd);
  assert.ok(credential.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUTH_CREDENTIALS, 'Credential_ID', 'CRD', 5, credential"));
  assert.ok(credential.includes('Username is already registered'), 'username duplicate check remains');
  assert.ok(!credential.includes('generateNextId_'));

  const passStart = security.indexOf('function apiLoginWithPassword');
  const passEnd = security.indexOf('\nfunction apiLoginWithGoogleCredential', passStart);
  assert.ok(passStart >= 0 && passEnd > passStart, 'password login API boundaries exist');
  const passwordLogin = security.slice(passStart, passEnd);
  assert.ok(passwordLogin.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUTH_SESSIONS, 'Session_ID', 'SES', 6, session)"));

  const googleStart = security.indexOf('function apiLoginWithGoogleCredential');
  const googleEnd = security.indexOf('\nfunction apiLogout', googleStart);
  assert.ok(googleStart >= 0 && googleEnd > googleStart, 'Google login API boundaries exist');
  const googleLogin = security.slice(googleStart, googleEnd);
  assert.ok(googleLogin.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUTH_SESSIONS, 'Session_ID', 'SES', 6, session)"));

  const auditStart = security.indexOf('function writeAuditLog_');
  const auditEnd = security.length;
  assert.ok(auditStart >= 0 && auditEnd > auditStart, 'audit function boundaries exist');
  const audit = security.slice(auditStart, auditEnd);
  assert.ok(audit.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUDIT_LOGS, 'Audit_ID', 'AUD', 5, auditRecord)"));
  assert.ok(!audit.includes('generateNextId_'));
});


test('no legacy generated-ID callsites remain in repository source', () => {
  const sources = [code, security, initialSetup, wbsDiagnostic, indexHtml, presentationHtml];
  sources.forEach((source, index) => assert.ok(!source.includes('generateNextId_('), 'legacy callsite removed from source #' + index));
});


test('escalation upserts serialize writes and use shared ID-based DB helpers', () => {
  const start = code.indexOf('function apiUpsertEscalationItem');
  const end = code.indexOf('var PHASE19_HEADERS_', start);
  assert.ok(start >= 0 && end > start, 'escalation API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes('lock.waitLock(10000)'), 'write path holds script lock');
  assert.ok(api.includes('insertRecord_(tabName, record)'), 'create uses shared insert helper');
  assert.ok(api.includes("updateRecordById_(tabName, 'Escalation_ID', escId, record)"), 'update uses ID-based shared helper');
  assert.ok(api.includes('Duplicate Escalation_ID rows detected'), 'ambiguous duplicate IDs are rejected');
  assert.ok(api.includes('Escalation does not belong to the target project'), 'updates cannot cross project ownership');
  assert.ok(api.includes('previousRecord = existing ? Object.assign({}, existing) : null'), 'previous escalation state is captured for audit');
  assert.ok(api.includes('previousRecord,\n      record,'), 'audit log receives previous and updated escalation values');
  assert.ok(!api.includes('sheet.appendRow('));
  assert.ok(!api.includes('.setValue(record[k])'));
});


test('client presentation deck creation locks ID collision checks and inserts through shared helper', () => {
  const start = code.indexOf('function apiGenerateClientPresentation');
  const end = code.indexOf('\nfunction generateAiSlideDeckWithGemini_', start);
  assert.ok(start >= 0 && end > start, 'client deck API boundaries exist');
  const api = code.slice(start, end);
  assert.ok(api.includes('lock.waitLock(10000)'), 'deck ID and insert are serialized');
  assert.ok(api.includes('const existingIds'), 'collision check reads existing IDs');
  assert.ok(api.includes('insertRecord_(CLIENT_DECKS_SHEET_'), 'deck append uses shared insert helper');
  assert.ok(!api.includes('sh.appendRow('));
  const ensureStart = code.indexOf('function ensureClientPresentationsSheet_');
  const ensureEnd = code.indexOf('\nfunction readSheetObjectsSafe_', ensureStart);
  assert.ok(ensureStart >= 0 && ensureEnd > ensureStart, 'sheet initializer boundaries exist');
  const ensure = code.slice(ensureStart, ensureEnd);
  assert.ok(ensure.includes('lock.waitLock(10000)'), 'header creation is serialized');
});


test('Phase 18 and Phase 19 sheet initialization serialize header writes', () => {
  const p18Start = code.indexOf('function ensurePhase18Sheet_');
  const p18End = code.indexOf('\nfunction readPhase18RowsSafe_', p18Start);
  assert.ok(p18Start >= 0 && p18End > p18Start, 'Phase 18 initializer boundaries exist');
  const p18 = code.slice(p18Start, p18End);
  assert.ok(p18.includes('var ownsLock = !lock.hasLock()'));
  assert.ok(p18.includes('if (ownsLock) lock.waitLock(10000)'));
  assert.ok(p18.includes('if (ownsLock) lock.releaseLock()'));

  const p19Start = code.indexOf('function ensurePhase19Sheet_');
  const p19End = code.indexOf('\nfunction readPhase19RowsSafe_', p19Start);
  assert.ok(p19Start >= 0 && p19End > p19Start, 'Phase 19 initializer boundaries exist');
  const p19 = code.slice(p19Start, p19End);
  assert.ok(p19.includes('var ownsLock = !lock.hasLock()'));
  assert.ok(p19.includes('if (ownsLock) lock.waitLock(10000)'));
  assert.ok(p19.includes('if (ownsLock) lock.releaseLock()'));
});


test('authentication table header initialization is serialized', () => {
  const start = security.indexOf('function ensureHybridAuthTables_');
  const end = security.indexOf('\nfunction authRandomToken_', start);
  assert.ok(start >= 0 && end > start, 'auth table initializer boundaries exist');
  const api = security.slice(start, end);
  assert.ok(api.includes('const ownsLock = !lock.hasLock()'));
  assert.ok(api.includes('if (ownsLock) lock.waitLock(10000)'));
  assert.ok(api.includes('if (ownsLock) lock.releaseLock()'));
});


test('password login failure counters and credential revalidation are serialized', () => {
  const start = security.indexOf('function apiLoginWithPassword');
  const end = security.indexOf('\nfunction apiLoginWithGoogleCredential', start);
  assert.ok(start >= 0 && end > start, 'password login API boundaries exist');
  const api = security.slice(start, end);
  assert.ok(api.includes('lock.waitLock(10000)'), 'authentication counter updates are serialized');
  assert.ok(api.includes('invalidateTableCache_(DB_CONFIG.TABS.AUTH_CREDENTIALS)'), 'credential state is refreshed under lock');
  assert.ok(api.includes('const latestCreds = getTableRecords_(DB_CONFIG.TABS.AUTH_CREDENTIALS)'));
  assert.ok(api.includes('Number(current.Failed_Attempts || 0) + 1'), 'failed attempts increment from current state');
  assert.ok(api.includes('const users = getTableRecords_(DB_CONFIG.TABS.USERS)'), 'user eligibility is rechecked');
  assert.ok(!api.includes('Number(cred.Failed_Attempts || 0) + 1'), 'stale attempt counters are not used');
});


test('database reset and import require backup before destructive writes', () => {
  const resetStart = code.indexOf('function apiStartFreshDatabase');
  const resetEnd = code.indexOf('\nfunction apiCreateDatabaseBackupCopy', resetStart);
  assert.ok(resetStart >= 0 && resetEnd > resetStart, 'fresh database API boundaries exist');
  const reset = code.slice(resetStart, resetEnd);
  assert.ok(reset.includes('lock.waitLock(30000)'));
  const resetBackup = reset.indexOf('makeCopy(');
  const resetClear = reset.indexOf('dataRange.clearContent()');
  assert.ok(resetBackup >= 0 && resetClear > resetBackup, 'reset backup precedes clearing');
  assert.ok(reset.includes('START FRESH'), 'reset requires explicit confirmation');

  const importStart = code.indexOf('function apiImportDatabaseFromGoogleSheet');
  const importEnd = code.indexOf('\nfunction apiGetProjectModuleReportData', importStart);
  assert.ok(importStart >= 0 && importEnd > importStart, 'import API boundaries exist');
  const imp = code.slice(importStart, importEnd);
  assert.ok(imp.includes('lock.waitLock(30000)'));
  const importBackup = imp.indexOf('makeCopy(');
  const importClear = imp.indexOf('clearContent()');
  const importWrite = imp.indexOf('setValues(item.rows)');
  assert.ok(importBackup >= 0 && importClear > importBackup && importWrite > importBackup, 'import backup precedes replacement writes');
  assert.ok(imp.includes('Header mismatch'), 'source headers are validated before backup and mutation');
});


test('trusted administrator allowlist updates are serialized and avoid lost additions', () => {
  const start = security.indexOf('function setTrustedAdminEmails_');
  const end = security.indexOf('\nfunction isTrustedAdministratorEmail_', start);
  assert.ok(start >= 0 && end > start, 'trusted administrator helper boundaries exist');
  const api = security.slice(start, end);
  assert.ok(api.includes('const ownsLock = !lock.hasLock()'));
  assert.ok(api.includes('lock.waitLock(10000)'));
  assert.ok(api.includes('const current = getTrustedAdminEmails_()'), 'add reads current allowlist while locked');
  assert.ok(api.includes('if (current.indexOf(normalized) !== -1) return current'), 'duplicate additions are idempotent');
  assert.ok(api.includes('getTrustedAdminEmails_().filter'), 'removal is read-modify-write under lock');
});


test('atomic ID helper maps the ID header when it is not the first column', () => {
  let lockHeld = false, released = 0;
  const rows = [{ Email: 'old@example.com', User_ID: 'USR-001' }, { Email: 'other@example.com', User_ID: 'USR-008' }];
  const sheet = {
    getLastColumn: () => 2,
    getLastRow: () => rows.length + 1,
    getRange: (row, col, count) => ({
      getValues: () => row === 1 ? [['Email', 'User_ID']] : rows.slice(row - 2, row - 2 + count).map(r => [col === 2 ? r.User_ID : r.Email])
    })
  };
  const context = {
    LockService: { getScriptLock: () => ({
      hasLock: () => lockHeld,
      waitLock: () => { assert.equal(lockHeld, false); lockHeld = true; },
      releaseLock: () => { lockHeld = false; released++; }
    }) },
    getMasterSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    insertRecord_: (tab, record) => { assert.equal(lockHeld, true); rows.push(record); }
  };
  vm.createContext(context);
  vm.runInContext(extractHelper(), context);
  const record = { Email: 'new@example.com' };
  context.insertRecordWithGeneratedId_('Users', 'User_ID', 'USR', 3, record);
  assert.equal(record.User_ID, 'USR-009');
  assert.equal(rows.at(-1).User_ID, 'USR-009');
  assert.equal(lockHeld, false);
  assert.equal(released, 1);
});


test('Google sign-in validates token audience, issuer, email verification, and expiry', () => {
  const start = security.indexOf('function apiLoginWithGoogleCredential');
  const end = security.indexOf('\nfunction apiLogout', start);
  assert.ok(start >= 0 && end > start, 'Google login API boundaries exist');
  const api = security.slice(start, end);
  assert.ok(api.includes('token.length > 10000'), 'oversized tokens are rejected');
  assert.ok(api.includes("String(claims.aud || '') !== clientId"));
  assert.ok(api.includes("const subject = String(claims.sub || '').trim()"), 'subject claim is required');
  assert.ok(api.includes('!subject'), 'missing subject is rejected');
  assert.ok(api.includes("['accounts.google.com','https://accounts.google.com'].includes(issuer)"));
  assert.ok(api.includes("String(claims.email_verified || '').toLowerCase() === 'true'"));
  assert.ok(api.includes('expires <= Math.floor(Date.now()/1000)'));
  assert.ok(api.includes("insertRecordWithGeneratedId_(DB_CONFIG.TABS.AUTH_SESSIONS, 'Session_ID', 'SES', 6, session)"));
});


test('atomic ID helper releases lock when pre-insert callback throws', () => {
  const h = makeHarness();
  assert.throws(() => h.context.insertRecordWithGeneratedId_('Users', 'User_ID', 'USR', 3, {}, () => {
    throw new Error('simulated callback failure');
  }), /simulated callback failure/);
  assert.deepEqual(h.stats(), { lockHeld: false, waitCount: 1, releaseCount: 1 });
});


function makePasswordLoginHarness(options = {}) {
  const credential = {
    Credential_ID: 'CRD-00001',
    User_ID: 'USR-001',
    Username: 'tester',
    Password_Salt: 'salt',
    Password_Hash: options.currentHash || 'valid-hash',
    Is_Active: 'TRUE',
    Failed_Attempts: options.failedAttempts || 0,
    Locked_Until: '',
    Updated_At: ''
  };
  const user = { User_ID: 'USR-001', Full_Name: 'Test User', Role_Name: 'Project Manager', Is_Active: 'TRUE' };
  let lockHeld = false, waits = 0, releases = 0, credentialReads = 0;
  const sessions = [];
  const context = {
    AUTH_SESSION_HOURS_: 8,
    DB_CONFIG: { TABS: { AUTH_CREDENTIALS: 'Auth_Credentials', USERS: 'Users', AUTH_SESSIONS: 'Auth_Sessions' } },
    LockService: { getScriptLock: () => ({
      hasLock: () => lockHeld,
      waitLock: () => { assert.equal(lockHeld, false); lockHeld = true; waits++; },
      releaseLock: () => { assert.equal(lockHeld, true); lockHeld = false; releases++; }
    }) },
    ensureHybridAuthTables_: () => {},
    getTableRecords_: tab => {
      if (tab === 'Auth_Credentials') {
        credentialReads++
        if (options.staleHashOnSecondRead && credentialReads === 2) credential.Password_Hash = options.staleHashOnSecondRead;
        return [credential];
      }
      if (tab === 'Users') return [user];
      return [];
    },
    invalidateTableCache_: () => {},
    isTruthySheetFlag_: value => String(value).toUpperCase() === 'TRUE',
    normalizeRoleName_: value => String(value),
    hashPassword_: password => password === 'good' ? 'valid-hash' : 'bad-hash',
    updateRecordById_: (tab, idColumn, id, updates) => {
      assert.equal(lockHeld, true, 'credential update must occur under lock');
      Object.assign(credential, updates);
      return { previous: {}, updated: credential };
    },
    Utilities: { sleep: () => {} },
    getNowTimestamp_: () => '2026-11-28T00:00:00Z',
    authRandomToken_: () => 'raw-token',
    hashToken_: token => 'hash:' + token,
    insertRecordWithGeneratedId_: (tab, idColumn, prefix, pad, record) => {
      record[idColumn] = prefix + '-000001';
      sessions.push(record);
    },
    writeAuditLog_: () => {},
    Date: Date
  };
  vm.createContext(context);
  const start = security.indexOf('function apiLoginWithPassword');
  const end = security.indexOf('\nfunction apiLoginWithGoogleCredential', start);
  assert.ok(start >= 0 && end > start, 'password login function can be extracted');
  vm.runInContext(security.slice(start, end), context);
  return { context, credential, sessions, stats: () => ({ lockHeld, waits, releases, credentialReads }) };
}

test('runtime mock: fifth failed password attempt locks account atomically', () => {
  const h = makePasswordLoginHarness({ failedAttempts: 4 });
  const result = h.context.apiLoginWithPassword('tester', 'wrong');
  assert.equal(result.success, false);
  assert.equal(h.credential.Failed_Attempts, 5);
  assert.ok(new Date(h.credential.Locked_Until).getTime() > Date.now());
  assert.equal(h.sessions.length, 0);
  assert.deepEqual(h.stats(), { lockHeld: false, waits: 1, releases: 1, credentialReads: 2 });
});

test('runtime mock: successful password login resets counters and creates hashed session', () => {
  const h = makePasswordLoginHarness({ failedAttempts: 3 });
  const result = h.context.apiLoginWithPassword('tester', 'good');
  assert.equal(result.success, true);
  assert.equal(result.token, 'raw-token');
  assert.equal(h.credential.Failed_Attempts, 0);
  assert.equal(h.credential.Locked_Until, '');
  assert.equal(h.sessions.length, 1);
  assert.equal(h.sessions[0].Session_ID, 'SES-000001');
  assert.equal(h.sessions[0].Token_Hash, 'hash:raw-token');
  assert.deepEqual(h.stats(), { lockHeld: false, waits: 1, releases: 1, credentialReads: 2 });
});

test('runtime mock: password hash changed between reads is rejected without session', () => {
  const h = makePasswordLoginHarness({ staleHashOnSecondRead: 'new-hash' });
  const result = h.context.apiLoginWithPassword('tester', 'good');
  assert.equal(result.success, false);
  assert.equal(h.credential.Failed_Attempts, 1);
  assert.equal(h.sessions.length, 0);
  assert.deepEqual(h.stats(), { lockHeld: false, waits: 1, releases: 1, credentialReads: 2 });
});


test('PMO digest trigger configuration serializes script-property and trigger mutations', () => {
  const start = code.indexOf('function apiSaveDigestTriggerConfig');
  const end = code.indexOf('\nfunction ', start + 10);
  assert.ok(start >= 0 && end > start, 'digest trigger API boundaries exist');
  const api = code.slice(start, end);
  const lock = api.indexOf('configLock.waitLock(10000)');
  const propertyWrite = api.indexOf('setProperty(PHASE17_PROP_KEY_');
  const triggerDelete = api.indexOf('ScriptApp.deleteTrigger(t)');
  const triggerCreate = api.indexOf('builder.create()');
  const release = api.indexOf('configLock.releaseLock()');
  assert.ok(lock >= 0 && propertyWrite > lock && triggerDelete > lock && triggerCreate > lock && release > triggerCreate, 'all trigger configuration mutations are inside lock scope');
});


test('full database backup copy serializes with database mutations', () => {
  const start = code.indexOf('function apiCreateDatabaseBackupCopy');
  const end = code.indexOf('\nfunction apiCreateDatabaseTemplateCopy', start);
  assert.ok(start >= 0 && end > start, 'backup API boundaries exist');
  const api = code.slice(start, end);
  const lock = api.indexOf('lock.waitLock(30000)');
  const copy = api.indexOf('source.makeCopy(');
  const release = api.indexOf('lock.releaseLock()');
  const audit = api.indexOf('writeAuditLog_');
  assert.ok(lock >= 0 && copy > lock && release > copy && audit > release, 'backup is copied under lock and audit is outside the lock');
});


test('activity dependency validation and synchronization are serialized with rollback', () => {
  const start = code.indexOf('function apiSaveActivity');
  const end = code.indexOf('\nfunction ', start + 10);
  assert.ok(start >= 0 && end > start, 'activity API boundaries exist');
  const api = code.slice(start, end);
  const lock = api.indexOf('activityMutationLock.waitLock(10000)');
  const cycleCheck = api.indexOf('wouldCreateDependencyCycle_');
  const dependencyWrite = api.indexOf("insertRecordWithGeneratedId_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', 'DEP', 4, dependency)");
  const release = api.indexOf('activityMutationLock.releaseLock()');
  assert.ok(lock >= 0 && cycleCheck > lock && dependencyWrite > lock && release > dependencyWrite, 'cycle checks and dependency writes share lock');
  assert.ok(api.includes("deleteRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', actId)"), 'failed create rolls back activity row');
  assert.ok(api.includes("updateRecordById_(DB_CONFIG.TABS.ACTIVITIES, 'Activity_ID', actId, existing)"), 'failed update restores prior activity');
  assert.ok(api.includes("updateRecordById_(DB_CONFIG.TABS.DEPENDENCIES, 'Dependency_ID', previousDependency.Dependency_ID, previousDependency)"), 'failed dependency sync restores previous active links');
});


test('progress log save serializes log, activity, audit, and rollup writes under one lock', () => {
  const start = code.indexOf('function apiSaveProgressLog');
  const end = code.indexOf('\nfunction apiReviewProgressLog', start);
  assert.ok(start >= 0 && end > start);
  const api = code.slice(start, end);
  const lock = api.indexOf('progressSaveLock.waitLock(10000)');
  const logWrite = api.indexOf('insertRecordWithGeneratedId_(DB_CONFIG.TABS.PROGRESS_UPDATES');
  const audit = api.indexOf('writeAuditLog_(ctx');
  const activityWrite = api.indexOf('updateRecordById_(DB_CONFIG.TABS.ACTIVITIES');
  const rollup = api.indexOf('recalculateProjectProgressEngine_(pid)');
  const release = api.indexOf('progressSaveLock.releaseLock()');
  assert.ok(lock >= 0 && logWrite > lock && audit > lock && activityWrite > lock && rollup > lock && release > rollup, 'multi-sheet progress save and rollup remain within lock scope');
});

test('progress review serializes approval, audit, activity write, and rollup under one lock', () => {
  const start = code.indexOf('function apiReviewProgressLog');
  const end = code.indexOf('\nfunction apiSaveWeeklyReport', start);
  assert.ok(start >= 0 && end > start);
  const api = code.slice(start, end);
  const lock = api.indexOf('progressReviewLock.waitLock(10000)');
  const logUpdate = api.indexOf('updateRecordById_(DB_CONFIG.TABS.PROGRESS_UPDATES');
  const audit = api.indexOf('writeAuditLog_(ctx');
  const activityWrite = api.indexOf('updateRecordById_(DB_CONFIG.TABS.ACTIVITIES');
  const rollup = api.indexOf('recalculateProjectProgressEngine_(pid)');
  const release = api.indexOf('progressReviewLock.releaseLock()');
  assert.ok(lock >= 0 && logUpdate > lock && audit > lock && activityWrite > lock && rollup > lock && release > rollup, 'multi-sheet approval and rollup remain within lock scope');
});
