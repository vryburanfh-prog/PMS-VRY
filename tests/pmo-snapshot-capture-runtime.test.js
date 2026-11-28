const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const start = source.indexOf('function apiCapturePmoSnapshot(');
const end = source.indexOf('\nfunction ', start + 1);
assert.notEqual(start, -1, 'snapshot API function must exist');
const functionSource = source.slice(start, end === -1 ? source.length : end);

function createHarness(existingId) {
  const events = [];
  const headers = ['Project_ID', 'Label', 'Snapshot_ID', 'Notes', 'Captured_By', 'Captured_At',
    'Total_Budget', 'Total_Committed', 'Total_Actual', 'Budget_Variance', 'Open_Escalations',
    'Overdue_Items', 'High_Alerts'];
  const rows = [headers, ['P-1', 'existing', existingId, '', '', '', '', '', '', '', '', '', '']];
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length,
    getRange(row, col, numRows, numCols) {
      events.push('getRange:' + row + ':' + col);
      return {
        getValues() {
          if (row === 1) return [headers];
          return rows.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols));
        }
      };
    },
    appendRow(values) {
      events.push('append');
      rows.push(values);
    }
  };
  let randomCalls = 0;
  const sandbox = {
    assertPrivilegedManagementRole_: () => events.push('privileged'),
    assertPermission_: () => ({userEmail: 'tester@example.com'}),
    ensurePhase19Sheet_: () => sheet,
    computePhase19CurrentMetrics_: () => {
      events.push('metrics');
      return {totalBudget: 1, totalCommitted: 2, totalActual: 3,
        budgetVariance: 4, openEscalations: 5, overdueItems: 6, highAlerts: 7};
    },
    LockService: {getScriptLock: () => ({
      waitLock: ms => events.push('lock:' + ms),
      releaseLock: () => events.push('release')
    })},
    Utilities: {formatDate: () => '20261128-120000'},
    Session: {getScriptTimeZone: () => 'UTC'},
    writeAuditLog_: (...args) => events.push('audit:' + args[1]),
    apiGetSnapshotsAndTemplatesData: () => ({success: true}),
    String, Date, Math: {floor: Math.floor, random: () => (randomCalls++ === 0 ? 0.2 : 0.3)},
  };
  const capture = vm.runInNewContext('(' + functionSource + ')', sandbox);
  return {capture, rows, events, headers};
}

test('runtime mock: collision retry uses Snapshot_ID header position and lock protects metric capture plus append', () => {
  const existing = 'SNP-20261128-120000-280000';
  const h = createHarness(existing);
  const result = h.capture({Project_ID: 'P-1', Label: 'test'}, 'P-1');
  const added = h.rows.at(-1);
  assert.equal(result.success, true);
  assert.equal(added[2], 'SNP-20261128-120000-370000', 'ID should retry collision using header-mapped column');
  assert.equal(added[0], 'P-1');
  assert.ok(h.events.indexOf('lock:30000') < h.events.indexOf('metrics'), 'lock begins before metric capture');
  assert.ok(h.events.indexOf('metrics') < h.events.indexOf('append'), 'metrics are captured before append under lock');
  assert.ok(h.events.indexOf('append') < h.events.indexOf('release'));
  assert.ok(h.events.indexOf('release') < h.events.indexOf('audit:CAPTURE_SNAPSHOT'));
});
