const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const database = fs.readFileSync(path.join(__dirname, '..', 'Database.gs'), 'utf8');

test('bulk database insert invalidates table cache after successful write', () => {
  const start = database.indexOf('function insertRecords_(');
  const end = database.indexOf('\nfunction ', start + 1);
  assert.notEqual(start, -1, 'insertRecords_ helper must exist');
  const helper = database.slice(start, end === -1 ? database.length : end);
  const writeIndex = helper.indexOf('.setValues(rows)');
  const invalidateIndex = helper.indexOf('invalidateTableCache_(tabName)');
  assert.notEqual(writeIndex, -1, 'bulk insert must write rows');
  assert.ok(invalidateIndex > writeIndex, 'cache invalidation must occur after successful write');
  assert.match(database, /DB_CACHEABLE_TABS_\\s*=\\s*\\['Role_Permissions',\\s*'System_Settings'\\]/);
});
