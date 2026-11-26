const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
test('weekly reports and workload scope fields are escaped in display and print templates', () => {
  const checks = [
    "escapeHtmlSafe_(r.Reporting_Week || 'Weekly Report')",
    "escapeHtmlSafe_(r.Reporting_Period || '-')",
    "escapeHtmlSafe_(r.Accomplishments || '-')",
    "escapeHtmlSafe_(r.Ongoing_Activities || '-')",
    "escapeHtmlSafe_(r.Pending_Activities || '-')",
    "escapeHtmlSafe_(r.Next_Steps || '-')",
    "escapeHtmlSafe_(r.Issues_Encountered || '-')",
    "escapeHtmlSafe_(r.Mitigation_Measures || '-')",
    "escapeHtmlSafe_(r.Management_Support_Needed || '-')",
    "escapeHtmlSafe_(r.Reporting_Week || '')",
    "escapeHtmlSafe_(r.Reporting_Period || '')",
    "escapeHtmlSafe_(w.Main_Scope_Of_Responsibility || '')",
    "escapeHtmlSafe_(w.Main_Scope_Of_Responsibility || '-')",
    "escapeHtmlSafe_(r.Project_ID)",
    "escapeHtmlSafe_(r.activeProjectsSummary || 'None active')"
  ];
  for (const fragment of checks) assert.ok(html.includes(fragment), fragment + ' must be escaped');
});
test('procurement, financial and error display strings are escaped', () => {
  for (const fragment of [
    "escapeHtmlSafe_(p.PO_Or_Reference || '-')",
    "escapeHtmlSafe_(p.Expected_Delivery_Date || '-')",
    "escapeHtmlSafe_(f.Cost_Category)",
    "escapeHtmlSafe_(r.Latest_Progress)",
    "escapeHtmlSafe_(err && err.message ? err.message : err)"
  ]) assert.ok(html.includes(fragment), fragment + ' must be escaped');
});
