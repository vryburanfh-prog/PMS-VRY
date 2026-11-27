'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function ensureClientPresentationsSheet_(');
const end = source.indexOf('\nfunction readSheetObjectsSafe_(', start);
assert.ok(start >= 0 && end > start, 'helper source boundaries found');
const helper = source.slice(start, end);
const headers = ['Deck_ID', 'Project_ID', 'Deck_Title', 'Focus_Scope'];
function run(existingSheet) {
  let created = null;
  const ss = {
    getSheetByName: () => existingSheet,
    insertSheet: name => { created = makeSheet(name, 0); return created; }
  };
  const context = { SpreadsheetApp: { getActiveSpreadsheet: () => ss }, CLIENT_DECKS_SHEET_: 'Client_Presentations', CLIENT_DECKS_HEADERS_: headers };
  vm.createContext(context);
  vm.runInContext(helper, context);
  const result = context.ensureClientPresentationsSheet_();
  return {result,created};
}
function makeSheet(name,lastRow) {
  return {name,lastRow,headerWrites:0,frozen:0,getLastRow(){return this.lastRow;},getRange(){return {setValues:v=>{this.headers=v[0];this.headerWrites++;}};},setFrozenRows(n){this.frozen=n;}};
}
test('existing empty Client_Presentations sheet receives headers and frozen row', () => {
  const empty = makeSheet('Client_Presentations',0);
  const state=run(empty);
  assert.equal(state.result,empty);
  assert.deepEqual(empty.headers,headers);
  assert.equal(empty.headerWrites,1);
  assert.equal(empty.frozen,1);
});
test('new Client_Presentations sheet is initialized', () => {
  const state=run(null);
  assert.ok(state.created);
  assert.deepEqual(state.created.headers,headers);
  assert.equal(state.created.headerWrites,1);
  assert.equal(state.created.frozen,1);
});
test('nonempty sheet is not overwritten', () => {
  const populated=makeSheet('Client_Presentations',4);
  run(populated);
  assert.equal(populated.headerWrites,0);
});
