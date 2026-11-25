const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiUpdateUser(userId, payload)');
const end = source.indexOf('function apiAdminResetPassword', start);
assert.ok(start >= 0 && end > start, 'apiUpdateUser function exists');
const fn = source.slice(start, end);

test('administrator user profile and role changes run under a script lock', () => {
  const lockStart = fn.indexOf('lock.waitLock(15000)');
  const userRead = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', userId)");
  const userWrite = fn.indexOf("updateRecordById_(DB_CONFIG.TABS.USERS, 'User_ID', userId");
  const sessionRevoke = fn.indexOf('revokeUserAuthSessions_(userId)');
  const audit = fn.indexOf('writeAuditLog_(ctx,');
  const release = fn.indexOf('lock.releaseLock()');
  assert.ok(lockStart >= 0 && userRead > lockStart && userWrite > userRead);
  assert.ok(sessionRevoke > userWrite && audit > userWrite && release > audit);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});

test('role/email changes revoke sessions and administrator trust changes stay in locked scope', () => {
  assert.match(fn, /revokeUserAuthSessions_\(userId\)/);
  assert.match(fn, /removeTrustedAdminEmail_\(existing\.Email\)/);
  assert.match(fn, /addTrustedAdminEmail_\(email\)/);
});
