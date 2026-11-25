'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const db = fs.readFileSync('Database.gs', 'utf8');
const code = fs.readFileSync('Code.gs', 'utf8');
const mapStart = db.indexOf('const PRIMARY_KEY_COLUMNS_BY_TAB_ = {');
const mapEnd = db.indexOf('};', mapStart) + 2;
const helperStart = db.indexOf('function validateImportedPrimaryKeys_(');
const helperEnd = db.indexOf('\nfunction assertUniquePrimaryKeyForInsert_(', helperStart);
assert.ok(mapStart >= 0 && mapEnd > mapStart && helperStart >= 0 && helperEnd > helperStart);
const context = {};
vm.createContext(context);
vm.runInContext(db.slice(mapStart, mapEnd) + '\n' + db.slice(helperStart, helperEnd), context);
test('import validation accepts unique, nonempty primary keys', () => {
  assert.doesNotThrow(() => context.validateImportedPrimaryKeys_('Projects', ['Project_ID', 'Name'], [['P-1','A'],['P-2','B']]));
});
test('import validation rejects duplicate primary keys', () => {
  assert.throws(() => context.validateImportedPrimaryKeys_('Projects', ['Project_ID'], [['P-1'],['P-1']]), /Duplicate Project_ID/);
});
test('import validation rejects missing primary keys', () => {
  assert.throws(() => context.validateImportedPrimaryKeys_('Projects', ['Project_ID'], [['P-1'],[' ']]), /Missing Project_ID/);
});
test('mapped table import fails when primary-key header is absent', () => {
  assert.throws(() => context.validateImportedPrimaryKeys_('Projects', ['Project_Name'], [['A']]), /Primary-key column/);
});
test('unmapped tabs do not fail validation', () => {
  assert.doesNotThrow(() => context.validateImportedPrimaryKeys_('Unmapped_Tab', ['Field'], [['']]));
});
test('import validation runs during plan-building before backup and writes', () => {
  const start = code.indexOf('function apiImportDatabaseFromGoogleSheet');
  const end = code.indexOf('function apiGetProjectModuleReportData', start);
  const body = code.slice(start, end);
  const validate = body.indexOf('validateImportedPrimaryKeys_(tabName, srcHeaders, importRows)');
  const backup = body.indexOf('makeCopy(');
  const clear = body.indexOf('clearContent()');
  const write = body.indexOf('setValues(item.rows)');
  assert.ok(validate >= 0 && backup > validate && clear > validate && write > validate, 'primary-key validation precedes backup and writes');
});
