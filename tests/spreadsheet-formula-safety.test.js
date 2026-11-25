const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const database = fs.readFileSync(path.join(__dirname, '..', 'Database.gs'), 'utf8');
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name + ' must exist');
  const next = source.slice(start + marker.length).search(/^function\s+\w+\s*\(/m);
  return source.slice(start, next < 0 ? undefined : start + marker.length + next);
}

const sanitizeSource = extractFunction(database, 'sanitizeSpreadsheetCellValue_');
const sanitizeSpreadsheetCellValue_ = new Function(sanitizeSource + '; return sanitizeSpreadsheetCellValue_;')();

test('formula-like strings are neutralized while numeric strings are preserved', () => {
  for (const value of ['=SUM(A1:A2)', '+cmd', '@HYPERLINK("https://bad.example")', '-cmd', '  =1+1']) {
    const result = sanitizeSpreadsheetCellValue_(value);
    assert.equal(result[0], "'", value + ' must be stored as literal text');
  }
  for (const value of ['-10', '+10', '12.5', '.75', '1e3']) assert.equal(sanitizeSpreadsheetCellValue_(value), value);
  assert.equal(sanitizeSpreadsheetCellValue_(10), 10);
});

test('all generic database writes sanitize user-provided cell values', () => {
  assert.match(database, /sanitizeSpreadsheetCellValue_\(recordObj/);
  assert.match(database, /sanitizeSpreadsheetCellValue_\(record\[header\]/);
  assert.match(database, /sanitizeSpreadsheetCellValue_\(next\)/);
  assert.match(database, /sanitizeSpreadsheetCellValue_\(patch\[header\]/);
});

test('direct append and cell-write APIs sanitize before writing', () => {
  assert.match(code, /setValue\(sanitizeSpreadsheetCellValue_\(record\[k\]\)\)/);
  assert.match(code, /appendRow\(newRowValues\.map\(sanitizeSpreadsheetCellValue_\)\)/);
  assert.match(code, /appendRow\(rowValues\.map\(sanitizeSpreadsheetCellValue_\)\)/);
  assert.match(code, /appendRow\(\[([\s\S]*?)\]\.map\(sanitizeSpreadsheetCellValue_\)\)/);
});

test('database import sanitizes values and restores only actual formulas', () => {
  assert.match(code, /function writeImportRowsPreservingFormulas_/);
  assert.match(code, /sourceRange\.getFormulas\(\)/);
  assert.match(code, /writeImportRowsPreservingFormulas_\(item\.dst, 2, item\.rows, item\.formulas, item\.cols\)/);
  assert.match(code, /writeImportRowsPreservingFormulas_\(item\.dst, 2, restoreRows, restoreFormulas, item\.cols\)/);
});
