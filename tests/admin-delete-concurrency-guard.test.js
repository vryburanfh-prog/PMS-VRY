'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function apiAdminDeleteUser(');
const end = source.indexOf('\nfunction ', start + 10);
assert.ok(start >= 0 && end > start, 'admin deletion function boundaries found');
const api = source.slice(start, end);
test('admin deletion acquires script lock before last-admin safety check', () => {
  const lock = api.indexOf('lock.waitLock(15000)');
  const targetRead = api.indexOf("findRecordRowById_(DB_CONFIG.TABS.USERS, 'User_ID', id)");
  const adminCount = api.indexOf('const activeAdmins =');
  const deletion = api.indexOf("deleteRecordsByIds_(DB_CONFIG.TABS.USERS, 'User_ID', [id])");
  assert.ok(lock >= 0 && targetRead > lock && adminCount > lock && deletion > adminCount,
    'locked block re-reads target and checks admin count before deleting');
});
test('admin deletion checks self-delete and last-admin protection inside lock', () => {
  const lock = api.indexOf('lock.waitLock(15000)');
  assert.ok(api.indexOf('You cannot delete your own Administrator account.') > lock);
  assert.ok(api.indexOf('The last active Administrator cannot be deleted.') > lock);
});
test('admin deletion retains exact User ID confirmation', () => {
  assert.match(api, /String\(confirmationText \|\| ''\)\.trim\(\) !== id/);
});
test('admin deletion always releases the script lock', () => {
  assert.match(api, /finally\s*\{\s*lock\.releaseLock\(\);\s*\}/);
});
