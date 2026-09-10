'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TasksListPicker } = require('../bin/tasks-list-picker');
const { TasksView } = require('../bin/tasks-view');
const { loadTasks } = require('../bin/tasks-data');
const key = (target, name, str = name) => target.handle(str, { name });
const fixture = { lists: ['today', 'work'], currentList: 'work', errors: [], tasks:
  ['today', 'work'].map(list => ({ list, title: 'Plan', description: '', id: list, completed: false, subtasks: [] })) };

test('picker preselects current list and filters names independently', () => {
  const picker = new TasksListPicker(fixture.lists, 2);
  assert.match(picker.lines(10).join('\n'), /▶ work/);
  key(picker, 't', 'TOD');
  assert.deepEqual(picker.visible().map(item => item.label), ['today']);
  assert.deepEqual(key(picker, 'return'), { index: 1 });
});

test('picker arrows, All lists, empty results, cancellation and editing', () => {
  const picker = new TasksListPicker(fixture.lists, 1);
  key(picker, 'up');
  assert.deepEqual(key(picker, 'return'), { index: 0 });
  key(picker, 'down');
  assert.deepEqual(key(picker, 'return'), { index: 1 });
  key(picker, 'z');
  assert.equal(key(picker, 'return'), null);
  assert.match(picker.lines(10).join('\n'), /no lists match/);
  key(picker, 'backspace');
  assert.equal(picker.visible().length, 3);
  assert.deepEqual(key(picker, 'escape'), { cancelled: true });
});

test('view initializes active list once and preserves chosen list on reload', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  assert.equal(view.listIndex, 2);
  key(view, 'l'); key(view, 'up'); key(view, 'up'); key(view, 'return');
  await view.reload();
  assert.equal(view.listIndex, 0);
  const fallback = new TasksView(() => {}, async () => ({ ...fixture, currentList: 'missing' }));
  await fallback.reload();
  assert.equal(fallback.listIndex, 0);
});

test('confirmed picker composes with task query and status; cancel changes neither', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  key(view, 's'); key(view, '/'); key(view, 'p', 'plan'); key(view, 'return');
  key(view, 'l'); key(view, 't', 'today'); key(view, 'escape');
  assert.equal(view.listIndex, 2);
  key(view, 'l'); key(view, 't', 'today'); key(view, 'return');
  assert.deepEqual(view.visible(), [fixture.tasks[0]]);
  assert.equal(view.query, 'plan');
  assert.equal(view.statusIndex, 1);
});

test('l is task search text, picker consumes keys and Tab still navigates tabs', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  key(view, '/'); assert.equal(key(view, 'l'), true);
  assert.equal(view.query, 'l'); assert.equal(view.picker, null);
  assert.equal(key(view, 'tab'), false);
  assert.equal(key(view, 'l'), true);
  key(view, 'g'); assert.equal(view.picker.query, 'g');
  assert.equal(key(view, 'tab'), false);
  assert.equal(view.picker, null);
  assert.equal(view.listIndex, 2);
});

test('loadTasks exposes only an existing active list without additional CLI commands', async () => {
  for (const currentList of ['work', 'missing', undefined]) {
    const data = await loadTasks(async args => args[0] === 'lists'
      ? { schemaVersion: 1, lists: fixture.lists, currentList }
      : { schemaVersion: 1, tasks: [] });
    assert.equal(data.currentList, currentList === 'work' ? 'work' : null);
  }
});
