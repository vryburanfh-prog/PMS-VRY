const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const db = fs.readFileSync(path.join(root, 'Database.gs'), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('public client-deck generation omits raw source metrics', () => {
  const generator = section(code, 'function apiGenerateClientPresentation', 'function generateAiSlideDeckWithGemini_');
  assert.doesNotMatch(generator, /rawMetrics\s*:\s*factPacket/);
});

test('public token endpoint strips rawMetrics from stored legacy decks', () => {
  const endpoint = section(code, 'function apiGetPublishedClientDeckByToken', 'function testAuthorizeExternalRequest_');
  assert.match(endpoint, /delete\s+deck\.rawMetrics/);
  assert.match(endpoint, /Status\s*\|\|\s*'PUBLISHED'/);
});

test('database import sanitizes formula-like strings before destination writes', () => {
  const importer = section(code, 'function apiImportDatabaseFromGoogleSheet', 'function apiGetProjectModuleReportData');
  assert.match(importer, /importedRows\s*=\s*importedRows\.map/);
  assert.match(importer, /\^\[\\s\]\*\[=\+\\-@\]/);
  const sanitizePos = importer.indexOf('importedRows = importedRows.map');
  const writePos = importer.indexOf('setValues(item.rows)');
  assert.ok(sanitizePos !== -1 && writePos > sanitizePos, 'sanitization should precede destination writes');
});

test('single and bulk insert helpers validate mapped primary keys under the insert lock', () => {
  assert.match(db, /function assertUniquePrimaryKeyForInsert_\(/);
  const single = section(db, 'function insertRecord_(', 'function insertRecords_(');
  const bulk = section(db, 'function insertRecords_(', 'function updateRecordById_(');
  assert.match(single, /assertUniquePrimaryKeyForInsert_\(/);
  assert.match(bulk, /assertUniquePrimaryKeyForInsert_\(/);
  assert.match(db, /Duplicate \+ idColumn \+ ' in insert batch'/);
  assert.match(db, /Record ID already exists in/);
});

test('primary-key mapping includes core generated-ID tables', () => {
  const mapping = section(db, 'const PRIMARY_KEY_COLUMNS_BY_TAB_', 'function assertUniquePrimaryKeyForInsert_');
  for (const table of ['Users', 'Projects', 'Main_WBS', 'Sub_WBS', 'Activities_Schedule', 'Schedule_Dependencies', 'Milestones', 'Permits', 'Risks', 'Issues', 'Approvals', 'Procurement_Logistics', 'Financial_Monitoring']) {
    assert.match(mapping, new RegExp(table + ':'));
  }
});
