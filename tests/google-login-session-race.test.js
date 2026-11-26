const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Security.gs', 'utf8');
const start = source.indexOf('function apiLoginWithGoogleCredential(idToken)');
const end = source.indexOf('function apiLogout()', start);
assert.ok(start >= 0 && end > start, 'Google login function exists and is extractable');
const fn = source.slice(start, end);

test('Google OAuth final authorization and session insert are serialized', () => {
  assert.match(fn, /LockService\.getScriptLock\(\)/);
  assert.match(fn, /lock\.waitLock\(10000\)/);
  assert.match(fn, /try\s*\{/);
  const recheck = fn.indexOf("getTableRecords_(DB_CONFIG.TABS.USERS)");
  const statusCheck = fn.indexOf("!isTruthySheetFlag_(user.Is_Active)");
  const sessionInsert = fn.indexOf("insertRecord_(DB_CONFIG.TABS.AUTH_SESSIONS");
  assert.ok(recheck >= 0 && statusCheck > recheck && sessionInsert > statusCheck);
  assert.match(fn, /isTrustedAdministratorEmail_\(email\)/);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});

test('OAuth session is issued only after locked checks and audit failure is non-fatal', () => {
  const sessionInsert = fn.indexOf("insertRecord_(DB_CONFIG.TABS.AUTH_SESSIONS");
  const successResponse = fn.indexOf("return \{ success:true, token:bearer");
  const auditTry = fn.indexOf("try\s*\{\s*writeAuditLog_", sessionInsert);
  assert.ok(sessionInsert >= 0 && successResponse > sessionInsert);
  assert.match(fn, /Login succeeded, but audit logging failed/);
  assert.match(fn, /warning:auditWarning/);
});
