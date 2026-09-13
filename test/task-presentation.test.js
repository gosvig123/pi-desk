'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TasksView } = require('../bin/tasks-view');
const { taskRows, taskMetadata, taskOptionLabel, detailRows } = require('../bin/task-presentation');
const { displayWidth, ellipsize } = require('../bin/task-layout');
const { styleTaskRow } = require('../bin/task-styles');
const { stripVTControlCharacters } = require('node:util');
const task = (id, extra = {}) => ({ id, title: id, list: 'work', completed: false,
  dueDate: '', description: '', subtasks: [], ...extra });
async function viewFor(tasks) {
  const view = new TasksView(() => {}, async () => ({ tasks, lists: ['work'], errors: [] }));
  await view.reload();
  return view;
}

test('long titles use a visible ellipsis without splitting emoji or exceeding cell width', () => {
  assert.equal(ellipsize('abc', 3), 'abc');
  assert.equal(ellipsize('abcdef', 4), 'abc…');
  assert.equal(ellipsize('👩‍💻👩‍💻👩‍💻', 4), '👩‍💻…');
  assert.equal(ellipsize('abc', 0), '');
  assert.equal(ellipsize('abc', 1), '…');
});

test('metadata shows subtask progress and only repeats list names in All lists', () => {
  const parent = task('Parent', { subtasks: [task('a', { completed: true }), task('b')] });
  assert.equal(taskMetadata(parent, true), 'No due date · 1/2 subtasks · work');
  assert.equal(taskMetadata(parent, false), 'No due date · 1/2 subtasks');
});

test('the task picker row keeps completion, due date, and list inside a narrow width', () => {
  assert.equal(taskOptionLabel(task('Ship it'), 78), '[ ] Ship it  No due date · work');
  assert.equal(taskOptionLabel(task('Ship it', { completed: true, list: 'today' }), 78), '[x] Ship it  No due date · today');
  for (const width of [8, 20, 38]) {
    assert.ok(displayWidth(taskOptionLabel(task('界'.repeat(20)), width)) <= width);
  }
});

test('task details list linked conversations without offering edits there', () => {
  const linked = detailRows(task('Title'), 78, [{ id: 'a', title: 'Fix build' }]);
  assert.ok(linked.includes('Conversations (1)'));
  assert.ok(linked.includes('▸ Fix build'));
  assert.ok(detailRows(task('Title'), 78).includes('Conversations (0)'));
  assert.ok(detailRows(task('Title'), 78).includes('c starts a conversation for this task'));
});

test('summary follows filters and cursor position without changing task order', async () => {
  const view = await viewFor([task('a'), task('b', { completed: true }), task('c')]);
  view.cursor = 2;
  assert.match(view.lines(20).join('\n'), /3\/3 · 2 pending · 1 completed/);
  view.handle('s', { name: 's' });
  assert.match(view.lines(20).join('\n'), /1\/2 · 2 pending · 0 completed/);
  assert.deepEqual(view.visible().map(item => item.id), ['a', 'c']);
});

test('selected task remains visible across viewport sizes and list boundaries', async () => {
  const view = await viewFor(Array.from({ length: 25 }, (_, index) => task(`Task ${index} 界👩‍💻`.repeat(8))));
  for (const height of [1, 2, 3, 5, 9, 16, 24]) for (const width of [20, 38, 78, 118]) {
    for (const cursor of [0, 12, 24]) {
      view.cursor = cursor;
      const rows = taskRows(view, height, width);
      assert.ok(rows.length <= height);
      assert.equal(rows.filter(row => row.startsWith('▶')).length, 1);
      assert.ok(rows.every(row => displayWidth(row) <= width));
    }
  }
});

test('terminal styles preserve sanitized text, fit width, and reset each styled row', async () => {
  const view = await viewFor([task('A long selected title'), task('Completed', { completed: true })]);
  for (const width of [20, 38, 78, 118]) {
    const plain = view.lines(10, width);
    const styled = view.renderLines(10, width);
    assert.deepEqual(styled.map(row => stripVTControlCharacters(row).trimEnd()), plain.map(row => row.trimEnd()));
    assert.ok(styled.every(row => displayWidth(stripVTControlCharacters(row)) <= width));
    assert.ok(styled.filter(row => row.includes('\x1b')).every(row => row.endsWith('\x1b[0m')));
    assert.ok(styled.some(row => row.startsWith('\x1b[7m')));
  }
  assert.match(styleTaskRow('      Overdue 2026-01-01', 38), /^\x1b\[33m/);
});

test('forms, details and list picker do not receive task-row styling', async () => {
  const view = await viewFor([task('Title')]);
  for (const name of ['return', 'escape', 'l', 'escape', 'e']) {
    view.handle(name, { name });
    if (name !== 'escape') assert.deepEqual(view.renderLines(15, 78), view.lines(15, 78));
  }
});
