'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskForm } = require('../bin/task-form');
const { TasksView } = require('../bin/tasks-view');
const { displayWidth } = require('../bin/task-layout');
const { dueLabel } = require('../bin/task-presentation');
const task = (id, extra = {}) => ({ id, title: id, list: 'work', revision: 'r1', completed: false,
  dueDate: '', description: 'Long description '.repeat(40), subtasks: [], ...extra });
const key = (form, name, extra = {}) => form.handle('', { name, ...extra });

test('editing uses grapheme cursor positions, insertion and forward/backward deletion', () => {
  const form = new TaskForm(task('A👩‍💻éZ'), false);
  key(form, 'home'); key(form, 'right'); key(form, 'delete');
  assert.equal(form.values.title, 'AéZ');
  form.handle('界', {}); key(form, 'left'); key(form, 'delete');
  key(form, 'end'); key(form, 'backspace'); key(form, 'backspace');
  assert.equal(form.values.title, 'A');
});

test('Enter advances to explicit save, Ctrl-S saves, Escape never saves, invalid fields focus', () => {
  const form = new TaskForm(task('Title'), false);
  for (let index = 0; index < 3; index++) assert.equal(key(form, 'return'), null);
  assert.equal(key(form, 'return').changes.title, 'Title');
  form.values.dueDate = '2026-02-30';
  assert.equal(key(form, 's', { ctrl: true }), null);
  assert.equal(form.index, 1);
  assert.match(form.lines(7, 38).join('\n'), /valid YYYY-MM-DD/);
  assert.deepEqual(key(form, 'escape'), { cancelled: true });
});

test('forms retain visible caret at 40/80/120 columns and short heights for every field', () => {
  const form = new TaskForm(task('界'.repeat(100)), false);
  for (const width of [38, 78, 118]) for (const height of [3, 5, 12, 23]) {
    for (const index of [0, 1, 2]) {
      form.index = index;
      const rows = form.lines(height, width);
      assert.ok(rows.length <= height);
      assert.ok(rows.every(row => displayWidth(row) <= width));
      assert.ok(rows.some(row => row.includes('▏')));
    }
  }
});

test('refresh preserves stable list/id selection and falls back to nearest remaining row', async () => {
  let tasks = ['a', 'b', 'c'].map(id => task(id));
  const view = new TasksView(() => {}, async () => ({ tasks, lists: ['work'], errors: [] }));
  await view.reload(); view.cursor = 1;
  tasks = [task('z'), ...tasks]; await view.reload();
  assert.equal(view.visible()[view.cursor].id, 'b');
  tasks = tasks.filter(row => row.id !== 'b'); await view.reload();
  assert.equal(view.visible()[view.cursor].id, 'c');
});

test('rows and scrollable details fit narrow and short terminals without repeated list names', async () => {
  const view = new TasksView(() => {}, async () => ({ tasks: [task('Title')], lists: ['work'], errors: [] }));
  await view.reload(); view.listIndex = 1;
  assert.equal(view.lines(20).filter(row => row.includes('work')).length, 1);
  key(view, 'return');
  for (const width of [38, 78, 118]) for (const height of [5, 10, 23]) {
    const rows = view.lines(height, width);
    assert.ok(rows.length <= height && rows.every(row => displayWidth(row) <= width));
  }
  for (let i = 0; i < 100; i++) key(view, 'down');
  assert.match(view.lines(10, 38).join('\n'), /ID: Title/);
});

test('due states use local calendar dates and do not call completed tasks overdue', () => {
  const now = new Date(2026, 9, 10, 12);
  assert.equal(dueLabel(task('a'), now), 'No due date');
  assert.match(dueLabel(task('a', { dueDate: '2026-10-10' }), now), /^Today/);
  assert.match(dueLabel(task('a', { dueDate: '2026-10-09' }), now), /^Overdue/);
  assert.match(dueLabel(task('a', { dueDate: '2026-10-09', completed: true }), now), /^Due/);
});

test('editing a due date keeps selected identity; completion under Pending picks nearest row', async () => {
  let tasks = ['a', 'b', 'c'].map(id => task(id));
  const view = new TasksView(() => {}, async () => ({ tasks: tasks.map(row => ({ ...row })), lists: ['work'], errors: [] }),
    async (_op, target, changes) => { tasks = tasks.map(row => row.id === target.id ? { ...row, ...changes } : row); });
  await view.reload(); view.cursor = 1;
  await view.actions.save('task.update', view.visible()[1], { dueDate: '2026-01-01' });
  assert.equal(view.visible()[view.cursor].id, 'b');
  assert.equal(view.cursor, 0);
  view.statusIndex = 1;
  await view.actions.save('task.setCompleted', view.visible()[0], { completed: true });
  assert.equal(view.visible()[view.cursor].id, 'a');
  assert.equal(view.statusIndex, 1);
});
