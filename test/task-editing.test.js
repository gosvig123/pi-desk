'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterTasks, loadTasks } = require('../bin/tasks-data');
const { mutateTask } = require('../bin/tasks-mutations');
const { TasksView } = require('../bin/tasks-view');
const { TaskForm } = require('../bin/task-form');
const key = (view, name, str = name) => view.handle(str, { name });
const tick = () => new Promise(resolve => setImmediate(resolve));
const task = { id: 'stable-id', list: 'work', revision: 'r1', title: 'Original', description: 'Notes',
  completed: false, dueDate: '2026-10-10', subtasks: [] };
const fixture = () => ({ lists: ['work', 'empty'], currentList: 'work', revisions: { work: 'r1', empty: 'r1' },
  tasks: [{ ...task }], errors: [] });

test('global due sorting ignores completion, puts undated last, preserves ties and input', () => {
  const tasks = ['', '2026-11-01', '2026-01-01', '2026-01-01', ''].map((dueDate, index) =>
    ({ ...task, id: String(index), dueDate, completed: index === 2 }));
  assert.deepEqual(filterTasks(tasks, null, '').map(row => row.id), ['2', '3', '1', '0', '4']);
  assert.deepEqual(tasks.map(row => row.id), ['0', '1', '2', '3', '4']);
});

test('loaded rows carry their own snapshot revision and lossless editor values', async () => {
  const result = await loadTasks(async args => args[0] === 'lists'
    ? { schemaVersion: 1, lists: ['work'] }
    : { schemaVersion: 1, revision: 'r2', tasks: [{ ...task, description: 'a\nb' }] });
  assert.equal(result.tasks[0].revision, 'r2');
  assert.equal(result.revisions.work, 'r2');
  assert.equal(result.tasks[0].editValues.description, 'a\nb');
});

test('create, edit, complete and reopen use the versioned machine contract', async () => {
  const calls = [];
  const execute = async request => { calls.push(request); return { success: true }; };
  for (const operation of ['task.create', 'task.update', 'task.setCompleted']) {
    await mutateTask(operation, operation === 'task.create' ? { ...task, id: undefined } : task,
      operation === 'task.setCompleted' ? { completed: true } : { title: 'Changed', dueDate: '' }, execute);
  }
  await mutateTask('task.setCompleted', task, { completed: false }, execute);
  assert.equal(calls[0].taskId, undefined);
  assert.equal(calls[0].list, 'work');
  assert.equal(calls[1].taskId, 'stable-id');
  assert.equal(calls[1].changes.dueDate, '');
  assert.deepEqual(calls.map(call => call.expectedRevision), ['r1', 'r1', 'r1', 'r1']);
  assert.deepEqual(calls.slice(2).map(call => call.changes.completed), [true, false]);
});

test('missing revision prevents writes; conflicts and backend errors are not retried', async () => {
  let calls = 0;
  const execute = async () => { calls++; return { success: false, error: { message: 'revision conflict' } }; };
  await assert.rejects(mutateTask('task.update', { ...task, revision: '' }, {}, execute), /reload/);
  assert.equal(calls, 0);
  await assert.rejects(mutateTask('task.update', task, {}, execute), /revision conflict/);
  assert.equal(calls, 1);
});

test('form validates title/date, supports clearing fields and cancels without saving', () => {
  const form = new TaskForm(task, false);
  form.values.title = ' ';
  assert.equal(form.submit(), null);
  form.values.title = 'Updated';
  form.values.dueDate = '2026-02-30';
  assert.equal(form.submit(), null);
  assert.equal(form.index, 1);
  form.handle('', { ctrl: true, name: 'u' });
  assert.equal(form.submit().changes.dueDate, '');
  assert.deepEqual(form.handle('', { name: 'escape' }), { cancelled: true });
});

test('view adds to selected empty list, keeps Tab in form and saves only on explicit save', async () => {
  const calls = [];
  const view = new TasksView(() => {}, async () => fixture(), async (...args) => calls.push(args));
  await view.reload();
  view.listIndex = 2;
  key(view, 'n');
  assert.match(view.lines(20).join('\n'), /List: empty/);
  key(view, 'a', 'Added');
  assert.equal(key(view, 'tab'), true);
  assert.equal(calls.length, 0);
  view.handle('', { name: 's', ctrl: true });
  await tick();
  assert.equal(calls[0][0], 'task.create');
  assert.equal(calls[0][1].list, 'empty');
  assert.equal(calls[0][2].title, 'Added');
  assert.equal(view.listIndex, 2);
});

test('view completion reloads placements, reopens, and blocks duplicate writes while saving', async () => {
  const data = fixture();
  let calls = 0;
  const view = new TasksView(() => {}, async () => data, async (_op, _target, changes) => {
    calls++;
    await tick();
    data.tasks[0].completed = changes.completed;
  });
  await view.reload();
  key(view, 'space', ' '); key(view, 'space', ' ');
  await tick(); await tick();
  assert.equal(calls, 1);
  assert.equal(view.visible()[0].completed, true);
  key(view, 'space', ' ');
  await tick(); await tick();
  assert.equal(view.visible()[0].completed, false);
});

test('view edits from details, preserves draft on error and cancels without further writes', async () => {
  let calls = 0;
  const view = new TasksView(() => {}, async () => fixture(), async () => { calls++; throw new Error('conflict'); });
  await view.reload(); key(view, 'return'); key(view, 'e');
  view.actions.form.values.title = 'Changed';
  view.handle('', { name: 's', ctrl: true }); await tick();
  assert.match(view.lines(20).join('\n'), /Changed/);
  assert.match(view.lines(20).join('\n'), /conflict/);
  key(view, 'escape');
  assert.equal(calls, 1);
  assert.equal(view.actions.form, null);
  assert.equal(view.visible()[0].title, 'Original');
});

test('search and list picker treat action keys as text', async () => {
  const view = new TasksView(() => {}, async () => fixture(), async () => assert.fail('unexpected write'));
  await view.reload(); key(view, '/'); key(view, 'n'); key(view, 'e'); key(view, 'space', ' ');
  assert.equal(view.query, 'ne ');
  key(view, 'escape'); key(view, 'l'); key(view, 'n'); key(view, 'e');
  assert.equal(view.picker.query, 'ne');
  assert.equal(view.actions.form, null);
});
