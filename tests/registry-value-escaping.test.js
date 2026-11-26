const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
test('dynamic project filters and input attributes are HTML escaped', () => {
  for (const fragment of [
    '.map(m => `<option value="${escapeHtmlSafe_(m)}">${escapeHtmlSafe_(m)}</option>`)',
    '.map(c => `<option value="${escapeHtmlSafe_(c)}">${escapeHtmlSafe_(c)}</option>`)',
    '.map(o => `<option value="${escapeHtmlSafe_(o)}">${escapeHtmlSafe_(o)}</option>`)',
    'uniqueStatuses.map(s => `<option value="${escapeHtmlSafe_(s)}">${escapeHtmlSafe_(s)}</option>`)',
    'value="${escapeHtmlSafe_(proj.Project_Manager || \'\')}"'
  ]) assert.ok(html.includes(fragment), fragment + ' must be escaped');
});
test('dynamic registry values and URL fields are escaped/sanitized', () => {
  assert.ok(html.includes('href="${escapeHtmlSafe_(safeDeckShareUrl_(val))}"'));
  assert.ok(html.includes('${escapeHtmlSafe_(val)}</span>'));
  assert.ok(html.includes('${escapeHtmlSafe_(val)}</td>'));
});
