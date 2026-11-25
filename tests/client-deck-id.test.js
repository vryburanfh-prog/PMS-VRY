'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('Code.gs', 'utf8');
const start = source.indexOf('function generateClientDeckId_');
const end = source.indexOf('function apiGenerateClientPresentation', start);
assert.ok(start >= 0 && end > start, 'Client deck ID helper boundaries should exist');
const helperSource = source.slice(start, end);
let uuidCounter = 0;
const context = {
  Utilities: {
    formatDate: () => '20261125-101010',
    getUuid: () => ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'][uuidCounter++]
  },
  Session: { getScriptTimeZone: () => 'UTC' },
  Date
};
vm.createContext(context);
vm.runInContext(helperSource, context);

test('client deck IDs remain unique for requests in the same second', () => {
  const first = context.generateClientDeckId_();
  const second = context.generateClientDeckId_();
  assert.equal(first, 'DECK-20261125-101010-111111111111');
  assert.equal(second, 'DECK-20261125-101010-222222222222');
  assert.notEqual(first, second);
});
