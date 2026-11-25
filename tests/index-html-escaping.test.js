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
    'escapeHtmlSafe_(d.focusScope)',
    'escapeHtmlSafe_(s.headlineTakeaway)'
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
  const safeUrlHelper = extractFunction(indexHtml, 'safeHttpsUrl_');
  const sanitizerHelper = extractFunction(indexHtml, 'sanitizeShareUrlForHtml_');
  const helpers = new Function(escapeHelper + safeUrlHelper + sanitizerHelper + '; return {safeHttpsUrl_, sanitizeShareUrlForHtml_};')();
  const sanitizer = helpers.sanitizeShareUrlForHtml_;
  assert.equal(sanitizer('javascript:alert(1)'), '');
  assert.equal(sanitizer('http://example.com'), '');
  assert.ok(sanitizer('https://example.com/?a=1&b=2').includes('&amp;'));
  assert.equal(helpers.safeHttpsUrl_('javascript:alert(1)'), '');
  assert.equal(helpers.safeHttpsUrl_('https://example.com'), 'https://example.com');
  assert.ok(indexHtml.includes('safeHttpsUrl_(res.shareUrl)'));
});

test('index inline JSON handlers serialize safely and print fields are escaped', () => {
  assert.ok(indexHtml.includes('onclick="startEditProject(${escapeHtmlSafe_(JSON.stringify(p))})"'));
  assert.ok(indexHtml.includes('onclick="promoteCandidateToEscalation_(${escapeHtmlSafe_(JSON.stringify(cand))})"'));
  assert.ok(indexHtml.includes('onclick="editEscalationRow_(${escapeHtmlSafe_(JSON.stringify(row))})"'));
  assert.ok(indexHtml.includes('onclick="resolveEscalationRow_(${escapeHtmlSafe_(JSON.stringify(row))})"'));
  assert.ok(indexHtml.includes('onclick="escalateWorkItem_(${escapeHtmlSafe_(JSON.stringify(it))})"'));
  assert.ok(indexHtml.includes('safeJsArg_(userId)'));
  assert.ok(indexHtml.includes('onclick="openProcurementAndFinancialsModule(${safeJsArg_(activeSub)})"'));
  assert.ok(indexHtml.includes('onclick="openEditUserModal_(${safeJsArg_(uid)})"'));
  assert.ok(indexHtml.includes('onclick="handleToggleUserStatus(${safeJsArg_(uid)}, false)"'));
  assert.ok(indexHtml.includes('function neutralizeCsvFormula_'));
  assert.ok(indexHtml.includes('headers.map(escapeCsvCell_)'));
  for (const field of ['escapeHtmlSafe_(r.Accomplishments || \'-\')','escapeHtmlSafe_(r.Remarks || \'-\')','escapeHtmlSafe_(l.Log_ID || \'\')','escapeHtmlSafe_(l.Submitted_By || \'\')']) assert.ok(indexHtml.includes('${' + field + '}'), field + ' must be escaped');
});

test('client CSV export neutralizes formula-like values', () => {
  const neutralizer = extractFunction(indexHtml, 'neutralizeCsvFormula_');
  const csvHelper = extractFunction(indexHtml, 'escapeCsvCell_');
  const helpers = new Function(neutralizer + csvHelper + '; return {neutralizeCsvFormula_, escapeCsvCell_};')();
  assert.equal(helpers.neutralizeCsvFormula_('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(helpers.neutralizeCsvFormula_('-cmd'), "'-cmd");
  assert.equal(helpers.neutralizeCsvFormula_('-12'), '-12');
  assert.equal(helpers.neutralizeCsvFormula_('+12'), '+12');
  assert.equal(helpers.escapeCsvCell_('=HYPERLINK("x")'), "\"'=HYPERLINK(\"\"x\"\")\"");
});
