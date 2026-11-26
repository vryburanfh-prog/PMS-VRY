const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('Security.gs', 'utf8');
const helperStart = source.indexOf('function updateCredentialLoginState_');
const loginStart = source.indexOf('function apiLoginWithPassword');
const googleStart = source.indexOf('function apiLoginWithGoogleCredential');
assert.ok(helperStart >= 0 && loginStart > helperStart && googleStart > loginStart, 'credential-state helper and login function must exist in order');
const helper = source.slice(helperStart, loginStart);
const login = source.slice(loginStart, googleStart);

test('login attempt counter updates are serialized and reread credential state', () => {
  assert.match(helper, /LockService\.getScriptLock\(\)/);
  assert.match(helper, /waitLock\(10000\)/);
  assert.match(helper, /findRecordRowById_\(DB_CONFIG\.TABS\.AUTH_CREDENTIALS,\s*'Credential_ID'/);
  assert.match(helper, /current\.Password_Hash/);
  assert.match(helper, /stale:\s*true/);
  assert.match(helper, /updateRecordById_\(DB_CONFIG\.TABS\.AUTH_CREDENTIALS/);
  assert.match(helper, /finally\s*\{\s*if\s*\(ownsLock\)\s*lock\.releaseLock\(\)/);
});

test('failed attempts increment the current locked value and lock after threshold', () => {
  assert.match(helper, /Number\(current\.Failed_Attempts\s*\|\|\s*0\)\s*\+\s*1/);
  assert.match(helper, /attempts\s*>=\s*5/);
  assert.match(helper, /15\s*\*\s*60\s*\*\s*1000/);
});

test('successful login resets attempts through the same locked helper', () => {
  assert.match(helper, /successful\s*\?\s*0\s*:/);
  assert.match(login, /updateCredentialLoginState_\(cred\.Credential_ID,\s*observedHash,\s*true\)/);
  assert.match(login, /if\s*\(!state\.updated\)/);
});

test('both password mismatch and match outcomes use serialized state helper', () => {
  assert.match(login, /updateCredentialLoginState_\(cred\.Credential_ID,\s*observedHash,\s*false\)/);
  assert.match(login, /candidate\s*!==\s*observedHash/);
  assert.match(login, /Password changed during login/);
});
