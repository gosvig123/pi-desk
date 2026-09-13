'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSelection } = require('../bin/session-selection');

const resume = { version: 1, sessionPath: '/sessions/a.jsonl', resumeMode: 'session', model: 'p/m', thinking: 'high' };

test('a resume selection keeps its validated fields', () => {
  assert.deepEqual(parseSelection(JSON.stringify(resume)), resume);
  assert.equal(parseSelection('   '), undefined);
});

test('a new conversation selection requires a task id', () => {
  const selection = { version: 1, newConversation: { task: { id: ' task-1 ', title: 'Ship it', list: 'work' } } };
  assert.deepEqual(parseSelection(JSON.stringify(selection)),
    { version: 1, newConversation: { task: { id: 'task-1', title: 'Ship it', list: 'work' } } });
  for (const bad of [{ version: 1, newConversation: {} },
    { version: 1, newConversation: { task: { id: ' ' } } },
    { version: 1, newConversation: null }]) {
    assert.throws(() => parseSelection(JSON.stringify(bad)), /task/);
  }
});

test('an invalid selection is rejected instead of changing the session', () => {
  const invalid = ['{', '[]', JSON.stringify({ ...resume, version: 2 }),
    JSON.stringify({ ...resume, sessionPath: 'relative.jsonl' }),
    JSON.stringify({ ...resume, resumeMode: 'other' }),
    JSON.stringify({ ...resume, thinking: 'impossible' }),
    JSON.stringify({ ...resume, model: 7 }),
    JSON.stringify({ ...resume, cwdOverride: 7 }),
    JSON.stringify({ ...resume, repaired: -1 })];
  for (const raw of invalid) assert.throws(() => parseSelection(raw));
});
