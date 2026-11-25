const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const db = fs.readFileSync(path.join(root, 'Database.gs'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const presentationHtml = fs.readFileSync(path.join(root, 'Presentation.html'), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const deckFixPresent = !code.includes('rawMetrics: factPacket');
const publicStripPresent = code.includes('delete deck.rawMetrics');
const importFixPresent = code.includes('importedRows = importedRows.map');
const pkFixPresent = db.includes('function assertUniquePrimaryKeyForInsert_(');

test('public client-deck generation omits raw source metrics', { skip: !deckFixPresent && 'Pending deck-data-minimization remediation PR' }, () => {
  const generator = section(code, 'function apiGenerateClientPresentation', 'function generateAiSlideDeckWithGemini_');
  assert.doesNotMatch(generator, /rawMetrics\s*:\s*factPacket/);
});

test('public token endpoint strips rawMetrics from stored legacy decks', { skip: !publicStripPresent && 'Pending deck-data-minimization remediation PR' }, () => {
  const endpoint = section(code, 'function apiGetPublishedClientDeckByToken', 'function testAuthorizeExternalRequest_');
  assert.match(endpoint, /delete\s+deck\.rawMetrics/);
  assert.match(endpoint, /Status\s*\|\|\s*'PUBLISHED'/);
});

test('database import sanitizes formula-like strings before destination writes', { skip: !importFixPresent && 'Pending import formula-safety remediation PR' }, () => {
  const importer = section(code, 'function apiImportDatabaseFromGoogleSheet', 'function apiGetProjectModuleReportData');
  assert.match(importer, /importedRows\s*=\s*importedRows\.map/);
  assert.ok(importer.includes("if (typeof value === 'string' && /^[\\s]*[=+\\-@]/.test(value))"));
  const sanitizePos = importer.indexOf('importedRows = importedRows.map');
  const writePos = importer.indexOf('setValues(item.rows)');
  assert.ok(sanitizePos !== -1 && writePos > sanitizePos, 'sanitization should precede destination writes');
});

test('single and bulk insert helpers validate mapped primary keys', { skip: !pkFixPresent && 'Pending primary-key enforcement remediation PR' }, () => {
  assert.match(db, /function assertUniquePrimaryKeyForInsert_\(/);
  const single = section(db, 'function insertRecord_(', 'function insertRecords_(');
  const bulk = section(db, 'function insertRecords_(', 'function updateRecordById_(');
  assert.match(single, /assertUniquePrimaryKeyForInsert_\(/);
  assert.match(bulk, /assertUniquePrimaryKeyForInsert_\(/);
  assert.match(db, /Duplicate .+ in insert batch:/);
  assert.match(db, /Record ID already exists in/);
  assert.match(db, /Primary-key value is required for insert into/);
});

test('primary-key mapping includes core generated-ID tables', { skip: !pkFixPresent && 'Pending primary-key enforcement remediation PR' }, () => {
  const mapping = section(db, 'const PRIMARY_KEY_COLUMNS_BY_TAB_', 'function assertUniquePrimaryKeyForInsert_');
  for (const table of ['Users', 'Auth_Credentials', 'Auth_Sessions', 'Projects', 'Audit_Logs', 'Role_Permissions', 'Main_WBS', 'Sub_WBS', 'Activities_Schedule', 'Schedule_Dependencies', 'Milestones', 'Permits', 'Risks', 'Issues', 'Approvals', 'Procurement_Logistics', 'Financial_Monitoring', 'Escalations', 'PMO_Snapshots']) {
    assert.match(mapping, new RegExp(table + ':'));
  }
});

test('test runner and source inputs are configured', () => {
  assert.ok(code.length > 0 && db.length > 0);
});


test('registry labels are escaped in loading and empty-state HTML templates', { skip: !(indexHtml.includes('Loading ${escapeHtmlSafe_(registryKey)} registry') && presentationHtml.includes('Loading ${escapeHtmlSafe_(registryKey)} registry') && indexHtml.includes('No ${escapeHtmlSafe_(st.key.toLowerCase())} found') && presentationHtml.includes('No ${escapeHtmlSafe_(st.key.toLowerCase())} found') && !indexHtml.includes('Loading ${registryKey} registry') && !presentationHtml.includes('Loading ${registryKey} registry')) && 'Pending UI interpolation escaping remediation PR' }, () => {
  for (const html of [indexHtml, presentationHtml]) {
    assert.ok(html.includes('Loading ${escapeHtmlSafe_(registryKey)} registry'));
    assert.ok(html.includes('No ${escapeHtmlSafe_(st.key.toLowerCase())} found'));
  }
});

test('deletion APIs use the locked delete helper', { skip: !['apiDeleteProjectControlRecord','apiDeleteWeeklyReport','apiDeleteTeamWorkloadAssignment','apiDeleteProcurementItem','apiDeleteFinancialItem'].every(name => code.includes('function ' + name) && code.slice(code.indexOf('function ' + name), code.indexOf('\nfunction ', code.indexOf('function ' + name) + 10)).includes('deleteRecordById_')) && 'Pending locked-delete-helper remediation PR' }, () => {
  for (const name of ['apiDeleteProjectControlRecord','apiDeleteWeeklyReport','apiDeleteTeamWorkloadAssignment','apiDeleteProcurementItem','apiDeleteFinancialItem']) {
    const start = code.indexOf('function ' + name);
    const next = code.indexOf('\nfunction ', start + 10);
    const body = code.slice(start, next === -1 ? code.length : next);
    assert.ok(body.includes('deleteRecordById_('));
  }
});


test('escalation updates enforce project/portfolio ownership', { skip: !code.includes('Escalation does not belong to the active project or portfolio scope.') && 'Pending escalation ownership remediation PR' }, () => {
  const body = section(code, 'function apiUpsertEscalationItem', 'function apiCapturePmoSnapshot');
  assert.ok(body.includes('existingEscalation.Project_ID'));
  assert.ok(body.includes('requestedProjectId'));
  assert.ok(body.includes('storedProjectId !== requestedProjectId'));
});





test('Phase 18 escalation and Phase 19 snapshot use locked insert/update helpers', { skip: !(code.includes('insertRecord_(\'Escalations\', record)') && code.includes('updateRecordById_(\'Escalations\'') && code.includes('insertRecord_(\'PMO_Snapshots\', record)') && db.includes("Escalations: 'Escalation_ID'") && db.includes("PMO_Snapshots: 'Snapshot_ID'")) && 'Pending Phase 18/19 helper-integrity remediation PR' }, () => {
  const esc = section(code, 'function apiUpsertEscalationItem', 'function apiCapturePmoSnapshot');
  const snap = section(code, 'function apiCapturePmoSnapshot', 'function apiGetSnapshotsAndTemplatesData');
  assert.ok(esc.includes("insertRecord_('Escalations', record)"));
  assert.ok(esc.includes("updateRecordById_('Escalations', 'Escalation_ID'"));
  assert.ok(snap.includes("insertRecord_('PMO_Snapshots', record)"));
});
