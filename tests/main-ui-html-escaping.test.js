const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
test('main UI dynamic project, registry, WBS and operational fields are escaped', () => {
  const checks = [
    'escapeHtmlSafe_(tabName)',
    'escapeHtmlSafe_(proj.Project_ID)',
    'escapeHtmlSafe_(proj.Project_Name)',
    'escapeHtmlSafe_(m.Main_WBS_ID)',
    'escapeHtmlSafe_(b.Remarks || \'-\')',
    'escapeHtmlSafe_(p.Client || \'-\')',
    'escapeHtmlSafe_(p.Project_Manager || \'-\')',
    'escapeHtmlSafe_(p.Project_Status || \'-\')',
    'escapeHtmlSafe_(p.Project_Location || \'-\')',
    'escapeHtmlSafe_(p.Project_Health || \'-\')',
    'escapeHtmlSafe_(s.id)',
    'escapeHtmlSafe_(s.name)',
    'escapeHtmlSafe_(f.label)',
    'escapeHtmlSafe_(c.label)',
    'escapeHtmlSafe_(l.Log_ID || \'\')',
    'escapeHtmlSafe_(l.Activity_ID || \'\')',
    'escapeHtmlSafe_([l.Main_WBS_ID, l.Sub_WBS_ID].filter(Boolean).join(\' / \'))',
    'escapeHtmlSafe_(l.Notes || \'-\')',
    'escapeHtmlSafe_(scopeLabel)',
    'escapeHtmlSafe_(status)',
    'escapeHtmlSafe_(r.Responsible_Team_Lead || \'-\')',
    'escapeHtmlSafe_(r.Reporting_Week || \'Weekly Report\')',
    'escapeHtmlSafe_(r.Accomplishments || \'-\')',
    'escapeHtmlSafe_(w.Employee_Name)',
    'escapeHtmlSafe_(w.Main_Scope_Of_Responsibility || \'-\')',
    'escapeHtmlSafe_(p.Item_Description)',
    'escapeHtmlSafe_(p.Vendor_Or_Carrier || \'-\')',
    'escapeHtmlSafe_(p.Delivery_Status || \'Pending\')',
    'escapeHtmlSafe_(f.Line_Item_Description || \'-\')',
    'escapeHtmlSafe_(f.Cost_Category)',
    'escapeHtmlSafe_(r.Project_Name)',
    'escapeHtmlSafe_(r.Status)',
    'escapeHtmlSafe_(r.Project_ID)',
    'escapeHtmlSafe_(r.Latest_Progress)',
    'escapeHtmlSafe_(r.activeProjectsSummary || \'None active\')',
    'escapeHtmlSafe_(JSON.stringify(cand))',
    'escapeHtmlSafe_(JSON.stringify(row))',
    'escapeHtmlSafe_(JSON.stringify(it))',
    'escapeHtmlSafe_(JSON.stringify(p))',
    'escapeHtmlSafe_(ts)',
    'escapeHtmlSafe_(actor)',
    'escapeHtmlSafe_(action)',
    'escapeHtmlSafe_(entity)',
    'escapeHtmlSafe_(note)',
    'escapeHtmlSafe_(r.bStart)',
    'escapeHtmlSafe_(r.bEnd)',
    'safeJsArg_(String(userId))',
    'escapeHtmlSafe_(l.Submitted_By || \'-\')',
    'escapeHtmlSafe_(dateStr)'
  ];
  for (const fragment of checks) assert.ok(html.includes(fragment), fragment + ' must be escaped');
});
test('dynamic registry and deck links are HTTPS-sanitized', () => {
  assert.ok(html.includes('function safeHttpsUrl_'));
  assert.ok(html.includes('safeHttpsUrl_(val)'));
  assert.ok(html.includes('safeHttpsUrl_(d.shareUrl)'));
});
test('main UI history exposes privileged revocation control', () => {
  assert.ok(html.includes('canManageProject_()'));
  assert.ok(html.includes('archiveClientDeck'));
  assert.ok(html.includes('safeJsArg_(d.deckId)'));
  assert.ok(html.includes('function archiveClientDeck(deckId)'));
  assert.ok(html.includes('.apiArchiveClientPresentation(deckId, pid)'));
});
