const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
function functionBlock(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const match = html.match(re);
  assert.ok(match, name + ' exists');
  return match[0];
}
test('client presentation history escapes dynamic HTML values', () => {
  const body = functionBlock('renderDeckHistoryList_');
  for (const value of ['d.deckTitle || d.deckId','d.focusScope','d.createdAt || \'\'','d.shareUrl']) {
    assert.ok(body.includes('escapeHtmlSafe_(' + value + ')'), value + ' must be escaped');
  }
});
test('client presentation slide preview escapes AI-generated text', () => {
  const body = functionBlock('submitGenerateClientDeck');
  assert.ok(body.includes('escapeHtmlSafe_(s.title || \'\')'), 'slide title escaped');
  assert.ok(body.includes('escapeHtmlSafe_(s.headlineTakeaway)'), 'slide takeaway escaped');
});
