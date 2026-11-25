const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name + ' must exist');
  const next = source.slice(start + marker.length).search(/\n\s*function\s+\w+\s*\(/);
  return source.slice(start, next < 0 ? undefined : start + marker.length + next);
}

test('index HTML project, WBS, registry, workload and report fields are escaped', () => {
  const required = [
    'escapeHtmlSafe_(proj.Project_ID)',
    'escapeHtmlSafe_(proj.Project_Name)',
    'escapeHtmlSafe_(p.Client || \'-\')',
    'escapeHtmlSafe_(p.Project_Manager || \'-\')',
    'escapeHtmlSafe_(p.Project_Location || \'-\')',
    'escapeHtmlSafe_(w.Employee_Name)',
    'escapeHtmlSafe_(l.Notes || \'\')',
    'escapeHtmlSafe_(st.key)',
    'escapeHtmlSafe_(it.id)',
    'escapeHtmlSafe_(d.focusScope)'
  ];
  for (const expression of required) assert.ok(indexHtml.includes('${' + expression + '}'), expression + ' must be escaped');
  assert.ok(indexHtml.includes('sanitizeShareUrlForHtml_(d.shareUrl)'));
});

test('inline index JavaScript parses after HTML escaping changes', () => {
  const scriptTags = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc\s*=/.test(m[1]));
  assert.equal(scriptTags.length, 1, 'expected one main inline script');
  const templatedScript = scriptTags[0][2].replace(/<\?!=[\s\S]*?\?>/g, '""').replace(/<\?[\s\S]*?\?>/g, '');
  new Function(templatedScript);
});
test('share URL sanitizer accepts HTTPS only and escapes attributes', () => {
  const escapeHelper = extractFunction(indexHtml, 'escapeHtmlSafe_');
  const sanitizerHelper = extractFunction(indexHtml, 'sanitizeShareUrlForHtml_');
  const sanitizer = new Function(escapeHelper + sanitizerHelper + '; return sanitizeShareUrlForHtml_;')();
  assert.equal(sanitizer('javascript:alert(1)'), '');
  assert.equal(sanitizer('http://example.com'), '');
  assert.ok(sanitizer('https://example.com/?a=1&b=2').includes('&amp;'));
});
