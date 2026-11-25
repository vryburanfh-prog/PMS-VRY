const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const presentation = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');

test('presentation resource position and department values are escaped before HTML insertion', () => {
  assert.ok(presentation.includes("${escapeHtmlSafe_([r.position, r.department].filter(Boolean).join(' • ') || '-')}"), 'resource position and department must be escaped');
});

test('numeric and progress values are escaped at HTML interpolation boundaries', () => {
  const requiredEscapedExpressions = [
    'escapeHtmlSafe_(m.WBS_Weight || 0)',
    'escapeHtmlSafe_(m.Baseline_Duration || 0)',
    'escapeHtmlSafe_(s.WBS_Weight || 0)',
    'escapeHtmlSafe_(s.Baseline_Duration || 0)',
    'escapeHtmlSafe_(d.Lag_Or_Lead_Days || 0)',
    'escapeHtmlSafe_(proj.Overall_Planned_Progress || 0)',
    'escapeHtmlSafe_(proj.Overall_Actual_Progress || 0)',
    'escapeHtmlSafe_(r.actualPct)',
    'escapeHtmlSafe_(p.Overall_Planned_Progress || 0)',
    'escapeHtmlSafe_(p.Overall_Actual_Progress || 0)',
    'escapeHtmlSafe_(w.Workload_Allocation_Pct || 0)'
  ];
  for (const expression of requiredEscapedExpressions) {
    assert.ok(presentation.includes('${' + expression + '}'), expression + ' must be HTML-escaped');
  }
});

test('remaining direct dynamic fields in HTML are escaped', () => {
  const required = [
    'escapeHtmlSafe_(a.Activity_Weight || 0)',
    'escapeHtmlSafe_(a.Baseline_Duration || 0)',
    'escapeHtmlSafe_(a.Schedule_Variance_Days || 0)',
    'escapeHtmlSafe_(b.Revision_Number)',
    'escapeHtmlSafe_(l.Quantity_Accomplished || 0)',
    'escapeHtmlSafe_(l.Reported_Progress_Pct || 0)',
    'escapeHtmlSafe_(mod)',
    'escapeHtmlSafe_(registryKey)',
    'escapeHtmlSafe_(st.projectId)'
  ];
  for (const expression of required) assert.ok(presentation.includes('${' + expression + '}'), expression + ' must be escaped');
});

test('registry key and dynamic KPI class are escaped in HTML text and attributes', () => {
  assert.ok(presentation.includes('${escapeHtmlSafe_(st.key)}'));
  assert.ok(presentation.includes('${escapeHtmlSafe_(c.color)}'));
});

test('workload position/department and weekly progress are escaped', () => {
  assert.ok(presentation.includes("${escapeHtmlSafe_([w.Position, w.Department_Or_Team].filter(Boolean).join(' • ') || '-')}"));
  assert.ok(presentation.includes('Planned: ${escapeHtmlSafe_(r.Overall_Planned_Progress || 0)}% | Actual: ${escapeHtmlSafe_(r.Overall_Actual_Progress || 0)}%'));
});

test('procurement quantity and financial burn percentage are escaped', () => {
  assert.ok(presentation.includes('${escapeHtmlSafe_(p.Quantity ?? 0)}'));
  assert.ok(presentation.includes('${escapeHtmlSafe_(f.Burn_Pct ?? 0)}%'));
});

test('user ID event arguments use safe JSON/HTML encoding', () => {
  assert.ok(presentation.includes('const safeUid = safeJsArg_(uid);'));
  assert.ok(presentation.includes('onclick="handleToggleUserStatus(${safeUid}, false)"'));
  assert.ok(presentation.includes('onclick="handleToggleUserStatus(${safeUid}, true)"'));
  assert.ok(presentation.includes('onclick="openEditUserModal_(${safeUid})"'));
});

test('workload WBS/date summaries and portfolio resource counts are escaped', () => {
  assert.ok(presentation.includes('${escapeHtmlSafe_(wbsStr)}'));
  assert.ok(presentation.includes('${escapeHtmlSafe_(dateStr)}'));
  assert.ok(presentation.includes('${escapeHtmlSafe_(r.Overallocated_Resources)}'));
});
