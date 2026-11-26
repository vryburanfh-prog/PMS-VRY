const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
function functionBlock(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const tail = html.slice(start + 1);
  const next = tail.match(/\n\s{0,6}function\s+\w+\s*\(/);
  return html.slice(start, next ? start + 1 + next.index : html.length);
}
test('client presentation history escapes dynamic text and sanitizes share links', () => {
  const body = functionBlock('renderDeckHistoryList_');
  for (const value of ['d.deckTitle || d.deckId','d.focusScope','d.createdAt || \'\'']) {
    assert.ok(body.includes('escapeHtmlSafe_(' + value + ')'), value + ' must be escaped');
  }
  assert.ok(body.includes('escapeHtmlSafe_(safeDeckShareUrl_(d.shareUrl))'), 'history link href must be sanitized and escaped');
});
test('deck share URL sanitizer allows only HTTPS without credentials', () => {
  const body = functionBlock('safeDeckShareUrl_');
  assert.ok(body.includes('new URL(raw)'), 'parses absolute URLs');
  assert.ok(body.includes("parsed.protocol !== 'https:'"), 'rejects non-HTTPS protocols');
  assert.ok(body.includes('parsed.username || parsed.password'), 'rejects credential-bearing URLs');
  assert.ok(body.includes("return '#';"), 'unsafe URLs fall back to inert anchor');
});
test('client presentation slide preview escapes AI text and sanitizes generated open link', () => {
  const body = functionBlock('submitGenerateClientDeck');
  assert.ok(body.includes('escapeHtmlSafe_(s.title || \'\')'), 'slide title escaped');
  assert.ok(body.includes('escapeHtmlSafe_(s.headlineTakeaway)'), 'slide takeaway escaped');
  assert.ok(body.includes('safeDeckShareUrl_(res.shareUrl)'), 'generated share link sanitized');
});
