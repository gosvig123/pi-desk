'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { taskIndex, taskTitle, taskListName, taskSearchText, taskChip, taskDetailRows, conversationsForTask } = require('../bin/task-link-meta');
const { displayWidth } = require('../bin/task-layout');

const palette = { mag: '', gry: '', R: '' };
const stored = { id: 'task-1', title: 'Old title', list: 'old-list' };

test('a renamed or moved task resolves through the live task index', () => {
  const index = taskIndex([{ id: 'task-1', title: 'New title', list: 'new-list' }]);
  assert.equal(taskTitle(stored, index), 'New title');
  assert.equal(taskListName(stored, index), 'new-list');
  assert.match(taskSearchText(stored, index), /new title/);
  assert.match(taskSearchText(stored, index), /new-list/);
  assert.doesNotMatch(taskSearchText(stored, index), /old title/);
});

test('the stored fallback is used only while the task index has no match', () => {
  const empty = taskIndex([]);
  assert.equal(taskTitle(stored, empty), 'Old title');
  assert.equal(taskListName(stored, empty), 'old-list');
  assert.equal(taskTitle({ id: 'task-9' }, empty), 'task-9');
  assert.equal(taskListName({ id: 'task-9' }, empty), 'unknown list');
  assert.equal(taskSearchText(null, empty), '');
  assert.equal(taskIndex().size, 0);
});

test('the chip and details show live values and fit narrow widths', () => {
  const index = taskIndex([{ id: 'task-1', title: '界'.repeat(30), list: 'moved' }]);
  const chip = taskChip(stored, index, palette);
  assert.match(chip, /^▸/);
  assert.ok(displayWidth(chip) <= 18);
  assert.equal(taskChip(null, index, palette), '');
  const rows = taskDetailRows(stored, index, palette, 60);
  assert.deepEqual(rows.map(([key]) => key), ['task', 'task id']);
  assert.match(rows[0][1], /moved/);
  assert.match(rows[0][1], /界/);
  assert.ok(displayWidth(rows[0][1]) <= 52);
  assert.deepEqual(taskDetailRows(null, index, palette, 60).map(([key]) => key), ['task']);
});

test('conversations are grouped by stable task id', () => {
  const sessions = [
    { id: 'a', title: 'A', task: { id: 'task-1' } },
    { id: 'b', title: 'B', task: { id: 'task-2' } },
    { id: 'c', title: 'C' },
  ];
  assert.deepEqual(conversationsForTask(sessions, 'task-1'), [{ id: 'a', title: 'A' }]);
  assert.deepEqual(conversationsForTask(sessions, 'task-2'), [{ id: 'b', title: 'B' }]);
  assert.deepEqual(conversationsForTask(sessions, 'missing'), []);
});
