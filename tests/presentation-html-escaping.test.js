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
