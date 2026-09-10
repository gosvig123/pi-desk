'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTasks, filterTasks, safeText, readTasksJson, TASK_STATUSES } = require('../bin/tasks-data');
const { TasksView } = require('../bin/tasks-view');

const task = (title, completed = false) => ({ id: title, title, completed, subtasks: [] });
const fixture = { lists: ['today', 'work projects'], tasks: [
  { ...task('Plan query'), list: 'today', description: 'Notes', dueDate: '2026-10-01' },
  { ...task('Query done', true), list: 'work projects', description: '', dueDate: '' },
], errors: [] };
const key = (view, name, str = name) => view.handle(str, { name });

 test('loadTasks uses only versioned reads and preserves list placements', async () => {
  const calls = [];
  const result = await loadTasks(async args => {
    calls.push(args);
    return args[0] === 'lists' ? { schemaVersion: 1, lists: fixture.lists }
      : { schemaVersion: 1, tasks: [task('Same task')] };
  });
  assert.deepEqual(calls, [['lists'], ['snapshot', '--list', 'today'], ['snapshot', '--list', 'work projects']]);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[1].list, 'work projects');
});

test('search composes with list selection, including completed tasks', () => {
  assert.equal(filterTasks(fixture.tasks, null, 'QUERY').length, 2);
  assert.deepEqual(filterTasks(fixture.tasks, 'work projects', 'query'), [fixture.tasks[1]]);
  assert.equal(filterTasks(fixture.tasks, 'today', 'done').length, 0);
});

test('status options compose with list and case-insensitive search', () => {
  const [all, pending, completed] = TASK_STATUSES;
  assert.deepEqual(TASK_STATUSES.map(status => status.label), ['All', 'Pending', 'Completed']);
  assert.deepEqual(filterTasks(fixture.tasks, null, 'QUERY', all), fixture.tasks);
  assert.deepEqual(filterTasks(fixture.tasks, null, '', pending), [fixture.tasks[0]]);
  assert.deepEqual(filterTasks(fixture.tasks, null, '', completed), [fixture.tasks[1]]);
  assert.deepEqual(filterTasks(fixture.tasks, 'work projects', 'QUERY', completed), [fixture.tasks[1]]);
  assert.deepEqual(filterTasks(fixture.tasks, 'work projects', 'query', pending), []);
  assert.deepEqual(filterTasks(fixture.tasks, 'today', 'missing', pending), []);
});

test('TasksView cycles status and preserves list and search on reload', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  assert.match(view.lines(20).join('\n'), /· All/);
  assert.match(view.help(), /s status/);
  key(view, ']'); key(view, ']');
  view.query = 'query'; view.cursor = 1;
  assert.equal(key(view, 's'), true);
  assert.equal(view.cursor, 0);
  assert.match(view.lines(20).join('\n'), /No matching tasks/);
  key(view, 's');
  await view.reload();
  assert.deepEqual(view.visible(), [fixture.tasks[1]]);
  assert.match(view.lines(20).join('\n'), /· Completed/);
  assert.equal(view.listIndex, 2);
  assert.equal(view.query, 'query');
  key(view, 's'); key(view, ']');
  assert.deepEqual(view.visible(), fixture.tasks);
});

test('status key is search text or ignored in details, not a filter change', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  key(view, '/'); key(view, 's');
  assert.equal(view.query, 's');
  assert.equal(view.statusIndex, 0);
  key(view, 'escape'); key(view, 'return'); key(view, 's');
  assert.equal(view.statusIndex, 0);
  assert.match(view.help(), /Esc back/);
});

test('partial list errors remain visible while other lists load', async () => {
  const result = await loadTasks(async args => {
    if (args[0] === 'lists') return { schemaVersion: 1, lists: ['today', 'work'] };
    if (args[2] === 'work') throw new Error('read failed');
    return { schemaVersion: 1, tasks: [task('Available')] };
  });
  assert.equal(result.tasks.length, 1);
  assert.match(result.errors[0], /work: read failed/);
});

test('schema errors and invalid responses fail clearly', async () => {
  for (const response of [{ schemaVersion: 2 }, { schemaVersion: 1, lists: null }, { error: 'migration_required' }]) {
    await assert.rejects(loadTasks(async () => response));
  }
  const result = await loadTasks(async args => args[0] === 'lists'
    ? { schemaVersion: 1, lists: ['today'] } : { schemaVersion: 1, tasks: [{}] });
  assert.match(result.errors[0], /Invalid task/);
});

test('task text cannot inject terminal controls', () => {
  assert.equal(safeText('hello\x1b[2J\n\x9bworld'), 'hello [2J  world');
});

test('TasksView search accepts q and filters lists without losing query', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  key(view, '/', '/');
  key(view, 'q'); key(view, 'u'); key(view, 'e'); key(view, 'r'); key(view, 'y');
  key(view, 'return');
  assert.equal(view.visible().length, 2);
  key(view, ']', ']');
  assert.equal(view.visible().length, 1);
  key(view, ']', ']');
  assert.equal(view.visible()[0].completed, true);
  assert.equal(view.query, 'query');
  key(view, ']', ']');
  assert.equal(view.visible().length, 2);
  assert.equal(key(view, 'tab'), false);
});

test('TasksView consumes every session action in list and details modes', async () => {
  const view = new TasksView(() => {}, async () => fixture);
  await view.reload();
  for (const name of ['f', 'o', 'x', 'g', 'G', 'p', 'c']) assert.equal(key(view, name), true);
  key(view, 'return');
  assert.match(view.help(), /Esc back/);
  for (const name of ['f', 'o', 'x', 'g', 'G', 'p', 'c']) assert.equal(key(view, name), true);
  assert.match(view.lines(20).join('\n'), /Due 2026-10-01/);
  key(view, 'escape');
  assert.equal(key(view, 'q'), false);
});

test('TasksView handles empty results, errors and retries', async () => {
  let calls = 0;
  const view = new TasksView(() => {}, async () => {
    if (++calls === 1) throw new Error('tasks CLI not found on PATH');
    return { lists: [], tasks: [], errors: [] };
  });
  await view.reload();
  assert.match(view.lines(20).join('\n'), /not found on PATH/);
  await view.reload();
  assert.match(view.lines(20).join('\n'), /No matching tasks/);
  assert.doesNotMatch(view.lines(20).join('\n'), /Error:/);
});

test('missing tasks binary produces actionable error', async () => {
  const previous = process.env.PATH;
  process.env.PATH = '';
  try { await assert.rejects(readTasksJson(['lists']), /not found on PATH/); }
  finally { process.env.PATH = previous; }
});
