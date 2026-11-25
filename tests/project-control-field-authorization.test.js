const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const presentation = fs.readFileSync(path.join(__dirname, '..', 'Presentation.html'), 'utf8');

function extractObjectLiteral(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, declaration + ' must exist');
  const braceStart = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\"' || c === '\\'') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(braceStart, i + 1); }
  }
  throw new Error('Could not extract object literal');
}

const registryLiteral = extractObjectLiteral(code, 'const CONTROLS_REGISTRY_CONFIG =');
const registryConfig = new Function('DB_CONFIG', 'return (' + registryLiteral + ')')({ TABS: new Proxy({}, { get: (_, name) => String(name) }) });

test('all project-control registry modules have field allowlists and required fields', () => {
  const expected = ['Milestones','Deliverables','Permits','Risks','Issues','Repository','Approvals'];
  assert.deepEqual(Object.keys(registryConfig).sort(), expected.sort());
  for (const [module, cfg] of Object.entries(registryConfig)) {
    assert.ok(Array.isArray(cfg.editableFields) && cfg.editableFields.length, module + ' must define editableFields');
    assert.ok(Array.isArray(cfg.requiredFields) && cfg.requiredFields.length, module + ' must define requiredFields');
    assert.equal(new Set(cfg.editableFields).size, cfg.editableFields.length, module + ' field allowlist must not contain duplicates');
    for (const reserved of [cfg.idCol, 'Project_ID', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At']) {
      assert.ok(!cfg.editableFields.includes(reserved), module + ' must not allow user input for reserved field ' + reserved);
    }
  }
});

test('approval status fields require approval permission and have safe create defaults', () => {
  assert.deepEqual(registryConfig.Deliverables.approvalFields, ['Approval_Status']);
  assert.equal(registryConfig.Deliverables.createDefaults.Approval_Status, 'Not Submitted');
  assert.deepEqual(registryConfig.Approvals.approvalFields, ['Approval_Status']);
  assert.equal(registryConfig.Approvals.createDefaults.Approval_Status, 'Pending Submission');
  assert.match(code, /Approval permission is required to change/);
});

test('API rejects unlisted payload fields and copies only allowlisted values', () => {
  assert.match(code, /const allowedFields = cfg\.editableFields \|\| \[\]/);
  assert.match(code, /Unsupported fields for/);
  assert.match(code, /allowedFields\.forEach\(function\(field\)/);
  assert.match(code, /cfg\.requiredFields \|\| \[\]/);
});

test('presentation form and payload omit approval-only fields for non-approvers', () => {
  assert.match(presentation, /REGISTRY_APPROVAL_FIELDS_/);
  assert.match(presentation, /schema\.fields\.filter\(f => st\.permissions\.approve \|\|/);
});
