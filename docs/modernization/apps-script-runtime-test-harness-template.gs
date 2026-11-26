/**
 * COPY THIS FILE ONLY INTO THE ISOLATED PHASE 1 TEST SCRIPT PROJECT.
 * Do not add it to or run it against the production Apps Script project.
 *
 * Manual GitHub Actions runner calls this function with the expected test
 * spreadsheet ID. It refuses to execute if the active spreadsheet differs.
 */
function phase1RuntimeIntegrationTestSuite(expectedSpreadsheetId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active container spreadsheet. Use a bound test project.');
  const actualSpreadsheetId = ss.getId();
  if (!expectedSpreadsheetId || actualSpreadsheetId !== String(expectedSpreadsheetId)) {
    throw new Error('Safety stop: active spreadsheet ID does not match the configured test ID.');
  }

  const tabName = '__PHASE1_RUNTIME_TESTS';
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = ss.insertSheet(tabName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 2).setValues([['Test_ID', 'Test_Marker']]);

  const tests = [];
  const assert_ = function(condition, message) {
    if (!condition) throw new Error('Phase 1 runtime assertion failed: ' + message);
  };

  try {
    // Test allocator uniqueness and monotonicity in the real Apps Script runtime.
    const ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push(generateNextId_(tabName, 'Test_ID', 'PH1RT', 6));
    }
    assert_(new Set(ids).size === ids.length, 'allocator returns distinct IDs');
    const suffixes = ids.map(id => Number(id.split('-').pop()));
    assert_(suffixes.every((value, i) => i === 0 || value > suffixes[i - 1]),
      'allocated suffixes are strictly increasing');
    tests.push({name: 'allocator uniqueness/monotonicity', status: 'PASS', allocated: ids.length});

    // Verify reconciliation against an existing synthetic high ID.
    sheet.getRange(2, 1, 1, 2).setValues([['PH1RT-900000', 'synthetic-high-watermark']]);
    const reconciled = generateNextId_(tabName, 'Test_ID', 'PH1RT', 6);
    assert_(Number(reconciled.split('-').pop()) > 900000,
      'allocator reconciles against a synthetic high suffix');
    tests.push({name: 'sheet high-watermark reconciliation', status: 'PASS', allocated: reconciled});

    // Test insert helper duplicate rejection on a test-only table. The registry
    // mapping is temporary to this execution and restored before returning.
    const registry = PRIMARY_KEY_COLUMNS_BY_TAB_;
    const priorMapping = registry[tabName];
    registry[tabName] = 'Test_ID';
    let duplicateRejected = false;
    const duplicateId = 'PH1RT-DUPLICATE-001';
    insertRecord_(tabName, {Test_ID: duplicateId, Test_Marker: 'first-insert'});
    try {
      insertRecord_(tabName, {Test_ID: duplicateId, Test_Marker: 'duplicate-attempt'});
    } catch (error) {
      duplicateRejected = /already exists|Duplicate/i.test(String(error && error.message || error));
    }
    assert_(duplicateRejected, 'duplicate primary-key insert is rejected');
    const rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 2).getValues();
    const duplicates = rows.filter(row => String(row[0]) === duplicateId).length;
    assert_(duplicates === 1, 'duplicate ID exists exactly once after rejected attempt');
    tests.push({name: 'duplicate insert rejection', status: 'PASS', retainedCount: duplicates});
    if (priorMapping === undefined) delete registry[tabName];
    else registry[tabName] = priorMapping;

    return {
      status: 'PASS',
      spreadsheetId: actualSpreadsheetId,
      tests: tests,
      executedAt: new Date().toISOString(),
      note: 'Sequential runtime smoke checks only; not a concurrent contention test.'
    };
  } finally {
    // Keep the dedicated test tab clean. The test allocator counter remains in
    // Script Properties under a test-only key and has no effect on production IDs.
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 2).setValues([['Test_ID', 'Test_Marker']]);
  }
}
