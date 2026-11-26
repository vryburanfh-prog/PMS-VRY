const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function bodyFor(name) {
  const m = source.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}'));
  assert.ok(m, name + ' should exist');
  return m[0];
}
const names=['apiSaveFinancialItem','apiDeleteFinancialItem','apiUpsertEscalationItem','apiQuickUpdateGanttActivity','apiRecalculateWeightedProgress'];
for(const name of names){
 test(name+' serializes auth, mutation, rollup and audit',()=>{
  const body=bodyFor(name);
  const lock=body.indexOf('LockService.getScriptLock()');
  const wait=body.indexOf('lock.waitLock(15000)');
  const auth=body.indexOf('assertPermission_(');
  const mutation=Math.min(...['updateRecordById_','insertRecord_','deleteRow(','appendRow(','setValue('].map(x=>body.indexOf(x)).filter(x=>x>=0));
  const rollup=body.indexOf('recalculateProjectProgressEngine_(');
  const audit=body.indexOf('writeAuditLog_(');
  const release=body.lastIndexOf('lock.releaseLock()');
  assert.ok(lock>=0&&wait>lock,'lock acquisition');
  assert.ok(auth>wait,'permission check protected');
  assert.ok(mutation>auth,'mutation follows permission');
  assert.ok(audit>mutation,'audit follows mutation');
  assert.ok(rollup<0||rollup>wait,'rollup protected');
  assert.ok(release>Math.max(audit,rollup),'release after protected operations');
  assert.match(body,/finally\s*\{[\s\S]*?lock\.releaseLock\(\);?\s*\}/,'guaranteed lock release');
 });
}

test('escalation creation uses the lock-protected allocator instead of timestamp-random IDs',()=>{
 const body=bodyFor('apiUpsertEscalationItem');
 const wait=body.indexOf('lock.waitLock(15000)');
 const idGeneration=body.indexOf("generateNextId_(resolvePhase18TabName_(), 'Escalation_ID', 'ESC', 5)");
 assert.ok(idGeneration>wait,'ID allocation occurs while the script lock is held');
 assert.doesNotMatch(body,/Math\.random\s*\(/,'random ID generation removed');
});

test('escalation creation uses duplicate-checked database insertion',()=>{
 const body=bodyFor('apiUpsertEscalationItem');
 const wait=body.indexOf('lock.waitLock(15000)');
 const insert=body.indexOf('insertRecord_(resolvePhase18TabName_(), record)');
 assert.ok(insert>wait,'insert helper executes inside the script lock');
 assert.doesNotMatch(body,/sheet\.appendRow\s*\(/,'direct append removed');
});
