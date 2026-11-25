const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('main UI escapes project and operational values and inline JSON', () => {
  for (const fragment of [
    "escapeHtmlSafe_(tabName)",
    "escapeHtmlSafe_(proj.Project_ID)",
    "escapeHtmlSafe_(p.Client || '-')",
    "escapeHtmlSafe_(p.Project_Manager || '-')",
    "escapeHtmlSafe_(l.Notes || '-')",
    "escapeHtmlSafe_(r.Accomplishments || '-')",
    "escapeHtmlSafe_(w.Employee_Name)",
    "escapeHtmlSafe_(p.Item_Description)",
    "escapeHtmlSafe_(JSON.stringify(p))",
    "escapeHtmlSafe_(JSON.stringify(row))",
    "escapeHtmlSafe_(JSON.stringify(cand))",
    "safeJsArg_(String(userId))",
    "escapeHtmlSafe_(l.Submitted_By || '-')"
  ]) assert.ok(html.includes(fragment), fragment + ' must be escaped');
});

test('registry and client deck history links are HTTPS-sanitized', () => {
  assert.ok(html.includes("function safeHttpsUrl_"));
  assert.ok(html.includes("safeHttpsUrl_(val)"));
  assert.ok(html.includes("safeHttpsUrl_(d.shareUrl)"));
  assert.ok(html.includes("escapeHtmlSafe_(d.deckTitle || d.deckId)"));
  assert.ok(html.includes("escapeHtmlSafe_(d.focusScope)"));
  assert.ok(html.includes("escapeHtmlSafe_(d.createdAt || '')"));
});

test('main UI exposes capability-gated presentation revocation', () => {
  assert.ok(html.includes("canManageProject_()"));
  assert.ok(html.includes("safeJsArg_(d.deckId)"));
  assert.ok(html.includes("function archiveClientDeck(deckId)"));
  assert.ok(html.includes(".apiArchiveClientPresentation(deckId, pid)"));
});
