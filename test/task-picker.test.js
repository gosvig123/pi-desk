'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskPicker } = require('../bin/task-picker');

const task = (id, extra = {}) => ({ id, title: id, list: 'work', completed: false,
  dueDate: '', description: '', subtasks: [], ...extra });
const key = (picker, name) => picker.handle(name.length === 1 ? name : '', { name });

test('the picker loads, then seeds the cursor on the linked task and offers detach', () => {
  const picker = new TaskPicker('task-2');
  assert.equal(picker.loading, true);
  assert.deepEqual(picker.visible(), []);
  picker.setTasks([task('task-1'), task('task-2')]);
  assert.equal(picker.loading, false);
  assert.deepEqual(picker.visible().map(row => row.detach ? 'detach' : row.task.id),
    ['detach', 'task-1', 'task-2']);
  assert.equal(picker.cursor, 2);
  assert.deepEqual(key(picker, 'return'), { task: task('task-2') });
});

test('an unlinked conversation has no detach row and links the first match', () => {
  const picker = new TaskPicker('');
  const tasks = [task('Plan query'), task('Query done', { completed: true })];
  picker.setTasks(tasks);
  assert.deepEqual(picker.visible().map(row => row.task.id), ['Plan query', 'Query done']);
  key(picker, 'down');
  assert.deepEqual(key(picker, 'return'), { task: tasks[1] });
});

test('typing filters tasks and Enter on the detach row clears the link', () => {
  const picker = new TaskPicker('task-1');
  picker.setTasks([task('task-1'), task('task-2')]);
  picker.cursor = 0;
  assert.deepEqual(key(picker, 'return'), { detach: true });
  picker.cursor = 1;
  key(picker, '2');
  assert.equal(picker.query, '2');
  assert.deepEqual(picker.visible().map(row => row.task.id), ['task-2']);
  assert.deepEqual(key(picker, 'return'), { task: task('task-2') });
  key(picker, 'backspace');
  assert.equal(picker.query, '');
  assert.equal(picker.visible()[0].detach, true);
});

test('cursor movement clamps and Escape always cancels', () => {
  const picker = new TaskPicker('task-2');
  picker.setTasks([task('task-1'), task('task-2')]);
  for (let index = 0; index < 5; index++) key(picker, 'down');
  assert.equal(picker.cursor, 2);
  for (let index = 0; index < 5; index++) key(picker, 'up');
  assert.equal(picker.cursor, 0);
  assert.deepEqual(key(picker, 'escape'), { cancelled: true });
});

test('a filter hides the detach row, so Enter cannot unlink by accident', () => {
  const unlinked = new TaskPicker('');
  unlinked.setTasks([task('task-1')]);
  unlinked.query = 'nothing matches';
  assert.equal(key(unlinked, 'return'), null);
  const linked = new TaskPicker('task-1');
  linked.setTasks([task('task-1')]);
  linked.cursor = 2;
  key(linked, 'z');
  assert.deepEqual(linked.visible(), []);
  assert.equal(key(linked, 'return'), null);
});

test('an error stays visible while the picker keeps working', () => {
  const picker = new TaskPicker('');
  picker.setTasks([]);
  picker.setError('tasks CLI not found on PATH');
  assert.equal(picker.error, 'tasks CLI not found on PATH');
  assert.deepEqual(picker.visible(), []);
});
