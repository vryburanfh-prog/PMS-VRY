const fs = require('node:fs');
const path = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiToggleUserStatus(userId, setActive, reason)');
const end = source.indexOf('/**', start);
assert.ok(start >= 0 && end > start, 'apiToggleUserStatus function exists and is extractable');
const fn = source.slice(start, end);

path('User status updates hold a script lock through mutation, revocation, and audit', () => {
  assert.match(fn, /LockService\.getScriptLock\(\)/);
  assert.match(fn, /lock\.waitLock\(10000\)/);
  assert.match(fn, /try\s*\{/);
  assert.match(fn, /findRecordRowById_\(DB_CONFIG\.TABS\.USERS,\s*'User_ID',\s*id\)/);
  assert.match(fn, /updateRecordById_\(DB_CONFIG\.TABS\.USERS,\s*'User_ID',\s*id/);
  assert.match(fn, /if\s*\(!setActive\)\s*revokeUserAuthSessions_\(id\)/);
  assert.match(fn, /writeAuditLog_\(/);
  assert.match(fn, /finally\s*\{\s*lock\.releaseLock\(\)/);
});

path('Self-deactivation guard uses the normalized ID and executes while locked', () => {
  const guard = fn.indexOf("id === String(ctx.user.userId || '').trim() && !setActive");
  const lockedRead = fn.indexOf("findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', id)");
  assert.ok(guard > lockedRead, 'self-deactivation check occurs after locked user reread');
  assert.match(fn, /You cannot deactivate your own active Administrator account/);
});
