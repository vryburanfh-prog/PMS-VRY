'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const security = fs.readFileSync('Security.gs', 'utf8');
const start = security.indexOf('function seedDefaultPermissions_(');
const end = security.indexOf('function applyManagementViewAllPagesPolicy_(', start);
assert.ok(start >= 0 && end > start, 'permission seed function boundaries exist');
const seed = security.slice(start, end);

test('permission seeding allocates IDs through the shared lock-protected allocator', () => {
  assert.match(seed, /generateNextId_\(DB_CONFIG\.TABS\.ROLE_PERMISSIONS,\s*'Permission_ID',\s*'PRM',\s*4\)/);
  assert.match(seed, /insertRecord_\(DB_CONFIG\.TABS\.ROLE_PERMISSIONS,\s*patch\)/);
  assert.doesNotMatch(seed, /maxId\s*\+\+|padStart\(4,\s*'0'\)/);
});

test('permission seeding serializes its read-modify-insert loop', () => {
  const lock = seed.indexOf('lock.waitLock(15000)');
  const read = seed.indexOf('getCachedTableRecords_(DB_CONFIG.TABS.ROLE_PERMISSIONS)');
  const loop = seed.indexOf('REQUIRED_SYSTEM_ROLES.forEach');
  const release = seed.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && read > lock && loop > read && release > loop, 'seed is serialized from initial read through all inserts');
});
