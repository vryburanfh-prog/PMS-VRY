const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function functionBody(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const end = code.indexOf('\nfunction ', start + 1);
  return code.slice(start, end === -1 ? code.length : end);
}

const deletePaths = [
  ['apiDeleteProjectControlRecord', 'deleteRecordsByIds_(cfg.tab, cfg.idCol, [recordId]);'],
  ['apiDeleteWeeklyReport', "deleteRecordsByIds_(DB_CONFIG.TABS.WEEKLY_REPORTS, 'Report_ID', [reportId]);"],
  ['apiDeleteTeamWorkloadAssignment', "deleteRecordsByIds_(DB_CONFIG.TABS.TEAM_WORKLOAD, 'Assignment_ID', [assignmentId]);"],
  ['apiDeleteProcurementItem', "deleteRecordsByIds_(procTab, 'Procurement_ID', [procurementId]);"],
  ['apiDeleteFinancialItem', "deleteRecordsByIds_(finTab, 'Financial_ID', [financialId]);"],
];

test('project delete APIs use lock-protected ID-based DB deletion helper', () => {
  for (const [name, helperCall] of deletePaths) {
    const body = functionBody(name);
    assert.ok(body.includes(helperCall), name + ' should call the shared ID deletion helper');
    assert.doesNotMatch(body, /\.deleteRow\s*\(/, name + ' should not delete by previously read row index');
  }
});
