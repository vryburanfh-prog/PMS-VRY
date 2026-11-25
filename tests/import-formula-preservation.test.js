const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name + ' must exist');
  const next = source.slice(start + marker.length).search(/^function\\s+\\w+\\s*\\(/m);
  return source.slice(start, next < 0 ? undefined : start + marker.length + next);
}

const writer = new Function(extractFunction(code, 'writeImportRowsPreservingFormulas_') + '; return writeImportRowsPreservingFormulas_;')();

test('import writer escapes formula-like text and restores formula cells', () => {
  const calls = [];
  const sheet = { getRange(row, col, rows, cols) { return { setValues(values) { calls.push({type:'values',row,col,values}); }, setFormulas(values) { calls.push({type:'formulas',row,col,values}); } }; } };
  writer(sheet, 2, [['=TEXT(1)','value',3]], [['','=SUM(1,2)','']], 3);
  assert.equal(calls[0].type, 'values');
  assert.equal(calls[0].values[0][0], "'=TEXT(1)");
  assert.equal(calls[1].type, 'formulas');
  assert.equal(calls[1].col, 2);
  assert.deepEqual(calls[1].values, [['=SUM(1,2)']]);
});

test('import and rollback paths call the formula-preserving writer', () => {
  assert.match(code, /sourceRange\.getFormulas\(\)/);
  assert.match(code, /item\.formulas/);
  assert.match(code, /restoreFormulas/);
});
