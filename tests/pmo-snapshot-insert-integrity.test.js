const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'Code.gs');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('function apiCapturePmoSnapshot(');
const end = source.indexOf('\nfunction ', start + 1);
assert.notEqual(start, -1, 'apiCapturePmoSnapshot must exist');
const capture = source.slice(start, end === -1 ? source.length : end);

test('snapshot capture serializes ID allocation and row insertion with script lock', () => {
  assert.match(capture, /LockService\.getScriptLock\(\)/);
  assert.match(capture, /snapshotLock\.waitLock\(30000\)/);
  assert.match(capture, /snapshotLock\.releaseLock\(\)/);
  assert.match(capture, /finally\s*\{[\s\S]*snapshotLock\.releaseLock\(\)/);
  assert.match(capture, /sheet\.appendRow\(rowValues\)/);
  const lockAt = capture.indexOf('snapshotLock.waitLock');
  const appendAt = capture.indexOf('sheet.appendRow(rowValues)');
  const releaseAt = capture.indexOf('snapshotLock.releaseLock()');
  assert.ok(lockAt < appendAt, 'lock must be acquired before append');
  assert.ok(appendAt < releaseAt, 'append must occur before lock release');
});

test('snapshot IDs check existing IDs and use six-digit random suffix', () => {
  assert.match(capture, /existingIds\.indexOf\(snapshotId\) !== -1/);
  assert.match(capture, /Math\.floor\(100000 \+ Math\.random\(\) \* 900000\)/);
  assert.match(capture, /record\.Snapshot_ID = snapshotId/);
});

test('snapshot row is mapped by header names and audited after insertion', () => {
  assert.match(capture, /headers\.map\(function\(h\)/);
  assert.match(capture, /writeAuditLog_\([\s\S]*'CAPTURE_SNAPSHOT'/);
  assert.ok(capture.indexOf('sheet.appendRow(rowValues)') < capture.indexOf("'CAPTURE_SNAPSHOT'"));
});
