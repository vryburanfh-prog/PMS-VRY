const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const security = fs.readFileSync(path.join(root, 'Security.gs'), 'utf8');

const intentionalExceptions = new Set([
  'apiGetPublishedClientDeckByToken', // public endpoint uses a published-deck token
  'apiLoginWithPassword', // unauthenticated login entry point
  'apiLogout', // logout/revocation entry point
  'apiDispatch', // dispatcher performs its own authentication and allowlist checks
]);
const authEntryPoints = new Set(['apiLoginWithGoogleCredential', 'apiLoginWithPassword', 'apiLogout', 'apiDispatch', 'apiGetSessionContext']);
const apiNames = new Set([
  ...[...code.matchAll(/function\s+(api\w+)\s*\(/g)].map(m => m[1]),
  ...[...security.matchAll(/function\s+(api\w+)\s*\(/g)].map(m => m[1]),
]);
const allowlistMatch = security.match(/var\s+PMS_API_ALLOWLIST_\s*=\s*(\[[\s\S]*?\]);/);
assert.ok(allowlistMatch, 'PMS_API_ALLOWLIST_ must be declared');
const allowlist = new Set([...allowlistMatch[1].matchAll(/['"](api\w+)['"]/g)].map(m => m[1]));

test('API inventory and authentication allowlist are synchronized', () => {
  const expected = new Set([...apiNames].filter(name => !intentionalExceptions.has(name)));
  const missing = [...expected].filter(name => !allowlist.has(name)).sort();
  const unexpected = [...allowlist].filter(name => !apiNames.has(name)).sort();
  assert.deepEqual({ missing, unexpected }, { missing: [], unexpected: [] },
    'every private API must be allowlisted and every allowlist entry must resolve to an API function');
});

test('authentication guards are installed for allowlisted API functions', () => {
  assert.match(security, /function\s+installApiAuthenticationGuards_\s*\(/);
  assert.match(security, /PMS_API_ALLOWLIST_\.forEach/);
  assert.match(security, /wrapped\.__pmoAuthWrapped\s*=\s*true/);
  assert.match(security, /installApiAuthenticationGuards_\(\)/);
});

test('intentional authentication and public endpoint exceptions are present and documented', () => {
  for (const name of intentionalExceptions) {
    assert.ok(apiNames.has(name), name + ' must remain in the API inventory');
  }
  assert.match(security, /Public tokenized deck endpoints remain outside this private dashboard API namespace/);
  assert.match(code + security, /apiDispatch/);
});

test('login and session context entry points are explicitly present', () => {
  for (const name of authEntryPoints) {
    assert.ok(apiNames.has(name), name + ' must remain in the API inventory');
  }
});
