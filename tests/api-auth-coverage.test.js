const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const security = fs.readFileSync(path.join(root, 'Security.gs'), 'utf8');

const publicExceptions = new Set(['apiGetPublishedClientDeckByToken']);
const authEntryPoints = new Set(['apiLoginWithGoogleCredential', 'apiGetSessionContext']);
const apiNames = new Set([
  ...[...code.matchAll(/function\s+(api\w+)\s*\(/g)].map(m => m[1]),
  ...[...security.matchAll(/function\s+(api\w+)\s*\(/g)].map(m => m[1]),
]);
const allowlistMatch = security.match(/var\s+PMS_API_ALLOWLIST_\s*=\s*(\[[\s\S]*?\]);/);
assert.ok(allowlistMatch, 'PMS_API_ALLOWLIST_ must be declared');
const allowlist = new Set([...allowlistMatch[1].matchAll(/['"](api\w+)['"]/g)].map(m => m[1]));

test('API inventory and authentication allowlist are synchronized', () => {
  const expected = new Set([...apiNames].filter(name => !publicExceptions.has(name)));
  assert.deepEqual([...expected].sort(), [...allowlist].sort(),
    'every private API must be allowlisted and every allowlist entry must resolve to an API function');
});

test('authentication guards are installed for allowlisted API functions', () => {
  assert.match(security, /function\s+installApiAuthenticationGuards_\s*\(/);
  assert.match(security, /PMS_API_ALLOWLIST_\.forEach/);
  assert.match(security, /wrapped\.__pmoAuthWrapped\s*=\s*true/);
  assert.match(security, /installApiAuthenticationGuards_\(\)/);
});

test('public token deck API is documented as an intentional exception', () => {
  for (const name of publicExceptions) {
    assert.match(code, new RegExp('function\\s+' + name + '\\s*\\('));
  }
  assert.match(security, /Public tokenized deck endpoints remain outside this private dashboard API namespace/);
});

test('login and session context entry points are explicitly present', () => {
  for (const name of authEntryPoints) {
    assert.ok(apiNames.has(name), name + ' must remain in the API inventory');
  }
});
