const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
test('dynamic project, registry, WBS, progress and report strings are HTML escaped', () => {
  const checks = [
    "escapeHtmlSafe_(tabName)",
    "escapeHtmlSafe_(proj.Project_ID)",
    "escapeHtmlSafe_(proj.Project_Name)",
    "escapeHtmlSafe_(p.Client || '-')",
    "escapeHtmlSafe_(p.Project_Manager || '-')",
    "escapeHtmlSafe_(p.Project_Location || '-')",
    "escapeHtmlSafe_(p.Project_Status || '-')",
    "escapeHtmlSafe_(p.Project_Health || '-')",
    "escapeHtmlSafe_(b.Remarks || '-')",
    "escapeHtmlSafe_(f.label)",
    "escapeHtmlSafe_(c.label)",
    "escapeHtmlSafe_(s.id)",
    "escapeHtmlSafe_(s.name)",
    "escapeHtmlSafe_(l.Notes || '')",
    "escapeHtmlSafe_(l.Notes || '-')",
    "escapeHtmlSafe_(r.Responsible_Team_Lead || '-')",
    "escapeHtmlSafe_(r.Remarks || '-')",
    "escapeHtmlSafe_(w.Employee_Name)",
    "escapeHtmlSafe_(w.Assignment_Status || 'Active')",
    "escapeHtmlSafe_(dateStr)",
    "escapeHtmlSafe_(p.Item_Description)",
    "escapeHtmlSafe_(p.Vendor_Or_Carrier || '-')",
    "escapeHtmlSafe_(p.Delivery_Status || 'Pending')",
    "escapeHtmlSafe_(r.Project_Name)",
    "escapeHtmlSafe_(r.Status)",
    "escapeHtmlSafe_(JSON.stringify(JSON.stringify(cand)))",
    "escapeHtmlSafe_(JSON.stringify(JSON.stringify(row)))",
    "escapeHtmlSafe_(JSON.stringify(JSON.stringify(it)))",
    "escapeHtmlSafe_(JSON.stringify(JSON.stringify(p)))",
    "escapeHtmlSafe_(scopeLabel)",
    "escapeHtmlSafe_(sectionTitle)",
    "escapeHtmlSafe_(alertLabel)",
    "escapeHtmlSafe_(status)",
    "escapeHtmlSafe_(ts)",
    "escapeHtmlSafe_(actor)",
    "escapeHtmlSafe_(action)",
    "escapeHtmlSafe_(entity)",
    "escapeHtmlSafe_(note)",
    "escapeHtmlSafe_(m.Main_WBS_ID)",
    "escapeHtmlSafe_(it.id)",
    "escapeHtmlSafe_(it.label)"
  ];
  for (const fragment of checks) assert.ok(html.includes(fragment), fragment + ' must be escaped');
});
test('permission module labels and user IDs use safe HTML/JavaScript escaping', () => {
  assert.ok(html.includes('<td class="py-2 px-3 font-medium">\${escapeHtmlSafe_(mod)}</td>'));
  assert.ok(html.includes('const safeUid = safeJsArg_(uid);'));
  assert.ok(html.includes('onclick="handleToggleUserStatus(\${safeUid}, false)"'));
  assert.ok(html.includes('onclick="handleToggleUserStatus(\${safeUid}, true)"'));
  assert.ok(html.includes('onclick="openEditUserModal_(\${safeUid})"'));
  assert.ok(!html.includes("onclick=\\"handleToggleUserStatus('\${safeUid}"));
});

test('audit-log and weekly-progress HTML strings are escaped before insertion', () => {
  assert.ok(html.includes("escapeHtmlSafe_(l.Log_ID || '')"));
  assert.ok(html.includes("escapeHtmlSafe_(l.Log_Date || '-')"));
  assert.ok(html.includes("escapeHtmlSafe_(l.Activity_ID || '')"));
  assert.ok(html.includes("escapeHtmlSafe_(l.Submitted_By || '')"));
  assert.ok(html.includes("escapeHtmlSafe_(l.Approval_Status || '')"));
  assert.ok(html.includes("escapeHtmlSafe_([l.Main_WBS_ID, l.Sub_WBS_ID].filter(Boolean).join(' / '))"));
});
