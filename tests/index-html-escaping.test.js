const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name + ' must exist');
  const next = source.slice(start + marker.length).search(/^[ \t]*function\s+\w+\s*\(/m);
  return source.slice(start, next < 0 ? undefined : start + marker.length + next);
}

test('main HTML templates escape server-controlled dynamic values', () => {
  const required = [
    "${escapeHtmlSafe_(tabName)}", "${escapeHtmlSafe_(proj.Project_ID)}", "${escapeHtmlSafe_(proj.Project_Name)}",
    "${escapeHtmlSafe_(m.Main_WBS_ID)}", "${escapeHtmlSafe_(m.WBS_Weight || 0)}", "${escapeHtmlSafe_(s.WBS_Weight || 0)}",
    "${escapeHtmlSafe_(a.Activity_Weight || 0)}", "${escapeHtmlSafe_(d.Lag_Or_Lead_Days || 0)}",
    "${escapeHtmlSafe_(b.Approved_By || '-')}", "${escapeHtmlSafe_(b.Remarks || '-')}",
    "${escapeHtmlSafe_(p.Client || '-')}", "${escapeHtmlSafe_(p.Project_Location || '-')}",
    "${escapeHtmlSafe_(p.Project_Status || '-')}", "${escapeHtmlSafe_(m)}", "${escapeHtmlSafe_(c)}",
    "${escapeHtmlSafe_(f.label)}", "${escapeHtmlSafe_(s)}", "const safeVal = escapeHtmlSafe_(val);",
    "${escapeHtmlSafe_(l.Notes || '')}", "${escapeHtmlSafe_(r.Accomplishments || '-')}",
    "${escapeHtmlSafe_(w.Employee_Name)}", "${escapeHtmlSafe_(w.Main_Scope_Of_Responsibility || '')}",
    "${escapeHtmlSafe_(p.Item_Description)}", "${escapeHtmlSafe_(f.Cost_Category)}",
    "${escapeHtmlSafe_(actor)}"
  ];  for (const expression of required) assert.ok(index.includes(expression), expression + ' must be escaped');
});

test('registry links allow HTTPS only and escape the resulting attribute', () => {
  const htmlEscaper = extractFunction(index, 'escapeHtmlSafe_');
  const escapeHtmlSafe_ = new Function(htmlEscaper + '; return escapeHtmlSafe_;')();
  assert.equal(escapeHtmlSafe_('<>&' + String.fromCharCode(34, 39)), '&lt;&gt;&amp;&quot;&#39;');
  const helper = extractFunction(index, 'safeExternalHref_');
  const safeExternalHref_ = new Function(helper + '; return safeExternalHref_;')();
  assert.equal(safeExternalHref_('https://example.com/path?a=1&b=2'), 'https://example.com/path?a=1&b=2');
  assert.equal(safeExternalHref_('javascript:alert(1)'), '');
  assert.equal(safeExternalHref_('http://example.com'), '');
  assert.equal(safeExternalHref_('/relative/path'), '');
  assert.ok(index.includes('href="${escapeHtmlSafe_(safeHref)}"'));
  assert.ok(index.includes('rel="noopener noreferrer"'));
});

test('project edit handler JSON is HTML-encoded inside its inline attribute', () => {
  assert.ok(index.includes('startEditProject(JSON.parse(${escapeHtmlSafe_(JSON.stringify(JSON.stringify(p)))}))'));
});

test('all inline index scripts parse as JavaScript', () => {
  const scripts = [...index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]))
    .map(match => match[2])
    .filter(script => script.trim());
  assert.ok(scripts.length > 0, 'inline script should exist');
  for (const script of scripts) {
    const normalized = script.replace(/<\?!=[\s\S]*?\?>/g, 'null');
    assert.doesNotThrow(() => new Function(normalized));
  }
});
