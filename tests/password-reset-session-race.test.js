const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const code = fs.readFileSync('Code.gs','utf8');
const sec = fs.readFileSync('Security.gs','utf8');
const resetStart=code.indexOf('function apiAdminResetPassword');
const resetEnd=code.indexOf('\n}',resetStart)+2;
const loginStart=sec.indexOf('function apiLoginWithPassword');
const loginEnd=sec.indexOf('function apiLoginWithGoogleCredential',loginStart);
const reset=code.slice(resetStart,resetEnd);
const login=sec.slice(loginStart,loginEnd);

test('password reset serializes hash update and session revocation under script lock',()=>{
  assert.match(reset,/LockService\.getScriptLock\(\)/);
  assert.match(reset,/waitLock\(10000\)/);
  assert.match(reset,/updateRecordById_\(DB_CONFIG\.TABS\.AUTH_CREDENTIALS/);
  assert.match(reset,/revokeUserAuthSessions_\(userId\)/);
  assert.ok(reset.indexOf('updateRecordById_') < reset.indexOf('revokeUserAuthSessions_'));
  assert.match(reset,/finally\s*\{\s*lock\.releaseLock\(\)/);
});

test('password login creates session only after locked credential and user rechecks',()=>{
  const session=login.indexOf('insertRecord_(DB_CONFIG.TABS.AUTH_SESSIONS');
  assert.ok(session>=0);
  const lock=login.lastIndexOf('lock.waitLock(10000)',session);
  assert.ok(lock>=0,'session creation must occur after acquiring the script lock');
  assert.match(login,/currentCredential\.Password_Hash/);
  assert.match(login,/currentUser\.Is_Active/);
  assert.match(login,/currentCredential\.Is_Active/);
  assert.match(login,/finally\s*\{\s*lock\.releaseLock\(\)/);
});
