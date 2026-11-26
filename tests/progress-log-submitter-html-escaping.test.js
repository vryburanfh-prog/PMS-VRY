const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
test('progress-log submitter values are escaped in HTML tables', () => {
  assert.ok(html.includes("escapeHtmlSafe_(l.Submitted_By || '-')"));
});
