const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const security = fs.readFileSync(path.join(__dirname, '..', 'Security.gs'), 'utf8');

test('Google ID token validation handles fetch and malformed JSON failures safely', () => {
  const login = security.slice(security.indexOf('function apiLoginWithGoogleCredential('), security.indexOf('\nfunction ', security.indexOf('function apiLoginWithGoogleCredential(') + 20));
  assert.match(login, /try\s*\{\s*const response = UrlFetchApp\.fetch/);
  assert.match(login, /JSON\.parse\(response\.getContentText\(\) \|\| '\\{\\}'\)/);
  assert.match(login, /catch \(verificationError\)/);
  assert.match(login, /verification is temporarily unavailable/);
});

test('Google token checks include audience, authorized party, issuer, subject, email verification, and expiry', () => {
  const login = security.slice(security.indexOf('function apiLoginWithGoogleCredential('), security.indexOf('\nfunction ', security.indexOf('function apiLoginWithGoogleCredential(') + 20));
  for (const check of ['claims.aud', 'claims.azp', 'claims.iss', 'claims.sub', 'claims.email_verified', 'Number.isFinite(expires)', 'expires <= nowSeconds']) assert.ok(login.includes(check), check + ' validation is required');
});
