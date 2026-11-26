const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
test('Gantt baseline date attributes are escaped', () => {
  assert.ok(html.includes('title="Baseline: ${escapeHtmlSafe_(r.bStart)} → ${escapeHtmlSafe_(r.bEnd)}"'));
});
test('user ID is passed through safe JS argument escaping for event handlers', () => {
  assert.ok(html.includes('handleToggleUserActive(${safeJsArg_(String(userId))}, ${nextActive})'));
});
