const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const security = fs.readFileSync(path.join(__dirname, '..', 'Security.gs'), 'utf8');

function extractTopLevelFunction(source, name) {
  const startMatch = source.match(new RegExp('^function\\s+' + name + '\\s*\\(', 'm'));
  assert.ok(startMatch, name + ' must be declared');
  const start = startMatch.index;
  const next = source.slice(start + startMatch[0].length).search(/^function\\s+\\w+\\s*\\(/m);
  return source.slice(start, next < 0 ? undefined : start + startMatch[0].length + next);
}

function getApiNames(source) {
  return [...source.matchAll(/^function\\s+(api\\w+)\\s*\\(/gm)].map(m => m[1]);
}

const allowlistMatch = security.match(/var PMS_API_ALLOWLIST_\\s*=\\s*(\\[[^\\]]*\\])/s);
assert.ok(allowlistMatch, 'PMS_API_ALLOWLIST_ must be declared as a literal array');
const allowlist = JSON.parse(allowlistMatch[1]);

test('private Code.gs API endpoints are allowlisted and guarded', () => {
  const publicTokenEndpoint = 'apiGetPublishedClientDeckByToken';
  const guardPattern = /assertPermission_\\(|assertPageAccess_\\(|assertAdministrator_\\(|assertDatabaseTransferAdmin_\\(|assertProjectAssignment_\\(|getCurrentUserContext_\\(/;
  const privateApis = getApiNames(code).filter(name => name !== publicTokenEndpoint);
  for (const name of privateApis) {
    assert.ok(allowlist.includes(name), name + ' must be included in the dispatcher allowlist');
    const body = extractTopLevelFunction(code, name);
    assert.match(body, guardPattern, name + ' must perform an authorization/authentication check');
  }
});

test('dispatcher allowlist entries resolve to a known API or an explicit auth entry point', () => {
  const known = new Set([...getApiNames(code), ...getApiNames(security), 'apiLoginWithPassword', 'apiLogout']);
  for (const name of allowlist) assert.ok(known.has(name), name + ' is allowlisted but not declared');
});

test('public client deck endpoint remains token-gated and outside private dispatcher allowlist', () => {
  const name = 'apiGetPublishedClientDeckByToken';
  assert.ok(!allowlist.includes(name), 'public token endpoint must not be part of private dispatcher allowlist');
  const body = extractTopLevelFunction(code, name);
  assert.match(body, /cleanToken/);
  assert.match(body, /\\^\\[a-f0-9\\]\\{32\\}\\/i);
  assert.match(body, /token/i);
});

test('dispatcher authenticates private RPC calls and wrappers protect direct calls', () => {
  assert.match(security, /function apiDispatch\\s*\\(/);
  assert.match(security, /if\\s*\\(!ctx\\s*\\|\\|\\s*!ctx\\.authenticated\\)/);
  assert.match(security, /function installApiAuthenticationGuards_\\s*\\(/);
  assert.match(security, /PMS_API_ALLOWLIST_\\.forEach/);
  assert.match(security, /wrapped\\s*=\\s*function\\s*\\(\\)\\s*\\{\\s*const ctx\\s*=\\s*getCurrentUserContext_\\(\\)/);
});
