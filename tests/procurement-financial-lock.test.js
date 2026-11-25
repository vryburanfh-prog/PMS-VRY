const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('Code.gs', 'utf8');
function functionSource(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + nextName + '(', start + 10);
  assert.ok(start >= 0 && end > start, name + ' exists');
  return source.slice(start, end);
}

test('procurement save and delete operations use locks', () => {
  const save = functionSource('apiSaveProcurementItem', 'apiDeleteProcurementItem');
  const deleteFn = functionSource('apiDeleteProcurementItem', 'apiSaveFinancialItem');
  const lock = save.indexOf('lock.waitLock(15000)');
  const lookup = save.indexOf("findRecordRowById_(procTab, 'Procurement_ID', rawId)");
  const id = save.indexOf("generateNextId_(procTab, 'Procurement_ID'");
  const update = save.indexOf("updateRecordById_(procTab, 'Procurement_ID'");
  const insert = save.indexOf('insertRecord_(procTab, record)');
  const updateAudit = save.indexOf("writeAuditLog_(ctx, 'UPDATE_PROCUREMENT'");
  const createAudit = save.indexOf("writeAuditLog_(ctx, 'CREATE_PROCUREMENT'");
  const release = save.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && lookup > lock && id > lock && update > lock && insert > lock);
  assert.ok(updateAudit > update && createAudit > insert && release > updateAudit && release > createAudit);
  assert.match(save, /finally\s*\{\s*lock\.releaseLock\(\)/);
  const dlock = deleteFn.indexOf('lock.waitLock(15000)');
  const dlookup = deleteFn.indexOf("findRecordRowById_(procTab, 'Procurement_ID', procurementId)");
  const ddelete = deleteFn.indexOf('deleteRow(existing._rowIndex)');
  const daudit = deleteFn.indexOf("writeAuditLog_(ctx, 'DELETE_PROCUREMENT'");
  const drelease = deleteFn.indexOf('lock.releaseLock()');
  assert.ok(dlock >= 0 && dlookup > dlock && ddelete > dlookup && daudit > ddelete && drelease > daudit);
});

test('financial save and delete operations use locks', () => {
  const save = functionSource('apiSaveFinancialItem', 'apiDeleteFinancialItem');
  const deleteFn = functionSource('apiDeleteFinancialItem', 'apiGetScheduleRiskData');
  const lock = save.indexOf('lock.waitLock(15000)');
  const lookup = save.indexOf("findRecordRowById_(finTab, 'Financial_ID', rawId)");
  const id = save.indexOf("generateNextId_(finTab, 'Financial_ID'");
  const update = save.indexOf("updateRecordById_(finTab, 'Financial_ID'");
  const insert = save.indexOf('insertRecord_(finTab, record)');
  const updateAudit = save.indexOf("writeAuditLog_(ctx, 'UPDATE_FINANCIAL'");
  const createAudit = save.indexOf("writeAuditLog_(ctx, 'CREATE_FINANCIAL'");
  const release = save.indexOf('lock.releaseLock()');
  assert.ok(lock >= 0 && lookup > lock && id > lock && update > lock && insert > lock);
  assert.ok(updateAudit > update && createAudit > insert && release > updateAudit && release > createAudit);
  assert.match(save, /finally\s*\{\s*lock\.releaseLock\(\)/);
  const dlock = deleteFn.indexOf('lock.waitLock(15000)');
  const dlookup = deleteFn.indexOf("findRecordRowById_(finTab, 'Financial_ID', financialId)");
  const ddelete = deleteFn.indexOf('deleteRow(existing._rowIndex)');
  const daudit = deleteFn.indexOf("writeAuditLog_(ctx, 'DELETE_FINANCIAL'");
  const drelease = deleteFn.indexOf('lock.releaseLock()');
  assert.ok(dlock >= 0 && dlookup > dlock && ddelete > dlookup && daudit > ddelete && drelease > daudit);
});
