const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiCreateUser(userPayload)');
const end = source.indexOf('function apiUpdateUser(', start);
assert.ok(start >= 0 && end > start, 'apiCreateUser exists');
const fn = source.slice(start, end);

test('user creation uniqueness checks and writes are serialized by ScriptLock', () => {
  const lock = fn.indexOf('lock.waitLock(15000)');
  const usernameCheck = fn.indexOf('existingCredentials.some');
  const emailCheck = fn.indexOf('existingUsers.some');
  const idGenerate = fn.indexOf("generateNextId_(DB_CONFIG.TABS.USERS");
  const userInsert = fn.indexOf('insertRecord_(DB_CONFIG.TABS.USERS, newUser)');
  const credentialCreate = fn.indexOf('createPasswordCredential_(newUser.User_ID');
  const assignmentSync = fn.indexOf('syncUserProjectAssignments_(newUser');
  const audit = fn.indexOf('writeAuditLog_(ctx,');
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && usernameCheck > lock && emailCheck > lock);
  assert.ok(idGenerate > lock && userInsert > idGenerate);
  assert.ok(credentialCreate > userInsert && assignmentSync > userInsert && audit > userInsert);
  assert.ok(release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});

test('project references are validated before the user record is inserted', () => {
  const validation = fn.indexOf('Cannot assign user to unknown Project_ID');
  const insertion = fn.indexOf('insertRecord_(DB_CONFIG.TABS.USERS, newUser)');
  assert.ok(validation >= 0 && insertion > validation);
});
