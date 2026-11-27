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

test('partial account-creation failures trigger compensating cleanup across dependent tables', () => {
  const catchStart = fn.indexOf('catch (creationError)');
  const assignmentCleanup = fn.indexOf("deleteRecordsByIds_(DB_CONFIG.TABS.PROJECT_ASSIGNMENTS", catchStart);
  const credentialCleanup = fn.indexOf("deleteRecordsByIds_(DB_CONFIG.TABS.AUTH_CREDENTIALS", catchStart);
  const trustedCleanup = fn.indexOf("removeTrustedAdminEmail_(email)", catchStart);
  const userCleanup = fn.indexOf("deleteRecordsByIds_(DB_CONFIG.TABS.USERS", catchStart);
  const rethrow = fn.indexOf('throw creationError', catchStart);
  assert.ok(catchStart > 0 && assignmentCleanup > catchStart);
  assert.ok(credentialCleanup > assignmentCleanup && trustedCleanup > credentialCleanup);
  assert.ok(userCleanup > trustedCleanup && rethrow > userCleanup);
  assert.match(fn, /cleanupErrors\.length/);
});

test('bulk project assignments reserve unique IDs before the batch insert', () => {
  const start = source.indexOf('function syncUserProjectAssignments_(');
  const end = source.indexOf('function apiCreateUser(', start);
  assert.ok(start >= 0 && end > start, 'assignment sync helper exists');
  const helper = source.slice(start, end);
  assert.match(helper, /generateNextId_\(DB_CONFIG\.TABS\.PROJECT_ASSIGNMENTS, 'Assignment_ID', 'ASG', 4\)/);
  assert.ok(helper.indexOf('generateNextId_(') < helper.indexOf('insertRecords_('));
  assert.doesNotMatch(helper, /maxAssignmentNumber/);
});
