const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');
function block(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const match = src.match(re);
  assert.ok(match, name + ' exists');
  return match[0];
}
test('archive presentation requires project edit permission and uses script lock', () => {
  const body = block(code, 'apiArchiveClientPresentation');
  assert.ok(body.includes('assertPermission_(\'Projects\', \'edit\', pid)'));
  assert.ok(body.includes('getScriptLock()'));
  assert.ok(body.includes('lock.waitLock(15000)'));
  assert.equal((body.match(/finally/g) || []).length, 1);
  assert.equal((body.match(/lock\.releaseLock\(\)/g) || []).length, 1);
  assert.ok(body.includes('lock.releaseLock()'));
  assert.ok(body.includes("setValue('ARCHIVED')"));
});
test('public deck endpoint only serves published decks', () => {
  const body = block(code, 'apiGetPublishedClientDeckByToken');
  assert.ok(body.includes("String(d.Status || 'PUBLISHED') === 'PUBLISHED'"));
});
test('history UI exposes link revocation control', () => {
  const body = block(html, 'renderDeckHistoryList_');
  assert.ok(body.includes('archiveClientDeck'));
  assert.ok(body.includes('canManageProject_()'));
  assert.ok(body.includes('safeDeckShareUrl_(d.shareUrl)'));
  assert.ok(body.includes('safeJsArg_(d.deckId)'));
});

test('archive UI refreshes published-deck list after revocation', () => {
  const body = block(html, 'archiveClientDeck');
  assert.ok(body.includes('.apiArchiveClientPresentation(deckId, pid)'));
  assert.ok(body.includes('openClientDeckModal()'));
});
