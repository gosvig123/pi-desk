'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripVTControlCharacters: plain } = require('node:util');
const { TasksView } = require('../bin/tasks-view');
const { boardLanes, localDay } = require('../bin/task-board-model');
const { displayWidth } = require('../bin/task-layout');
const task = (id, dueDate = '', completed = false) => ({ id, title: `Task ${id}`, dueDate, completed,
  list: 'Work', description: '', subtasks: [], revision: 'r1' });
const key = (view, name) => view.handle(name, { name });
async function createView(tasks) {
  const view = new TasksView(() => {}, async () => ({ lists: ['Work'], tasks, errors: [] }));
  await view.reload();
  view.listIndex = 1;
  return view;
}
const fixtures = () => [task('late', '1999-01-01'), task('today', localDay()),
  task('later', '2999-01-01'), task('unscheduled'), task('done', '1999-01-01', true)];

test('board uses the task widget date lanes, places completed tasks only in Completed, and keeps Today', () => {
  const lanes = boardLanes(fixtures());
  assert.deepEqual(lanes.map(lane => lane.title), ['Overdue', 'Today', 'Upcoming', 'No date', 'Completed']);
  assert.deepEqual(lanes.map(lane => lane.items.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(boardLanes([]).map(lane => lane.title), ['Today']);
  assert.equal(boardLanes([task('x', '2026-10-11')], '2026-10-10')[1].title, 'Upcoming');
});

test('wide view shows all columns; medium view scrolls columns with selection', async () => {
  const view = await createView(fixtures());
  const wide = view.lines(23, 178).join('\n');
  for (const title of ['Overdue (1)', 'Today (1)', 'Upcoming (1)', 'No date (1)', 'Completed (1)']) assert.ok(wide.includes(title));
  let rows = view.lines(23, 78);
  assert.match(rows.join('\n'), /Columns 1–2 of 5/);
  for (let i = 0; i < 4; i++) key(view, 'right');
  assert.equal(view.visible()[view.cursor].id, 'done');
  rows = view.lines(23, 78);
  assert.match(rows.join('\n'), /Completed \(1\)/);
  assert.match(rows.join('\n'), /Columns 4–5 of 5/);
  assert.equal(key(view, 'right'), true);
  assert.equal(key(view, 'tab'), false);
});

test('vertical navigation stays in its lane, horizontal navigation skips empty Today', async () => {
  const view = await createView([task('a', '1999-01-01'), task('b', '1999-01-02'), task('c'), task('d')]);
  view.lines(23, 118);
  key(view, 'down'); assert.equal(view.visible()[view.cursor].id, 'b');
  key(view, 'down'); assert.equal(view.visible()[view.cursor].id, 'b');
  key(view, 'right'); assert.equal(view.visible()[view.cursor].id, 'd');
  key(view, 'home'); assert.equal(view.visible()[view.cursor].id, 'c');
  key(view, 'left'); assert.equal(view.visible()[view.cursor].id, 'a');
  key(view, 'end'); assert.equal(view.visible()[view.cursor].id, 'b');
});

test('vertical scroll keeps the selected card visible and reports the visible range', async () => {
  const view = await createView(Array.from({ length: 30 }, (_, i) => task(`item-${i}`)));
  view.lines(23, 118);
  key(view, 'end');
  assert.equal(view.visible()[view.cursor].id, 'item-29');
  assert.match(view.lines(23, 118).join('\n'), /› \[ \] Task item-29/);
  assert.match(view.lines(23, 118).join('\n'), /of 30 · ↑↓ scroll/);
  key(view, 'pageup');
  assert.equal(view.cursor, 26);
});

test('compact cards have no blank gap and fit four cards in a 22-row board', async () => {
  const view = await createView(Array.from({ length: 8 }, (_, i) => task(`item-${i}`)));
  const rows = view.lines(25, 118);
  assert.equal(rows.filter(row => row.includes('╭')).length, 4);
  const firstBottom = rows.findIndex(row => row.includes('╰'));
  assert.ok(rows[firstBottom + 1].includes('╭'));
  assert.equal(view.boardPageSize, 4);
  key(view, 'pagedown');
  assert.equal(view.cursor, 4);
  assert.match(view.lines(25, 118).join('\n'), /› \[ \] Task item-4/);
});

test('resize switches between board and list without changing selected task', async () => {
  const view = await createView(fixtures());
  view.lines(23, 118); key(view, 'right');
  const selected = view.visible()[view.cursor].id;
  assert.ok(view.boardActive);
  assert.ok(!view.lines(23, 38).some(row => row.includes('╭')));
  assert.equal(view.boardActive, false);
  assert.equal(view.visible()[view.cursor].id, selected);
  assert.equal(key(view, 'left'), false);
  view.lines(10, 118); assert.equal(view.boardActive, false);
  view.lines(23, 118); assert.ok(view.boardActive);
});

test('cards and ANSI styles fit narrow, wide, short, and Unicode-heavy layouts', async () => {
  const tasks = fixtures().map(item => ({ ...item, title: '界👩‍💻é lengthy task title '.repeat(10) }));
  const view = await createView(tasks);
  for (const height of [1, 5, 10, 11, 17, 23, 40]) for (const width of [38, 72, 78, 118, 178]) {
    for (const cursor of [0, 2, 4]) {
      view.cursor = cursor;
      const rows = view.lines(height, width);
      const styled = view.renderLines(height, width);
      assert.ok(rows.length <= height);
      assert.deepEqual(styled.map(row => plain(row).trimEnd()), rows.map(row => row.trimEnd()));
      assert.ok(styled.every(row => displayWidth(plain(row)) <= width));
      if (view.boardActive) assert.ok(rows.some(row => row.includes('›')));
    }
  }
});

test('board filters, search, details and editing use the selected task', async () => {
  const view = await createView(fixtures());
  view.lines(23, 118); key(view, 'right');
  key(view, 'return'); assert.equal(view.mode, 'details');
  assert.match(view.lines(23, 118).join('\n'), /Task today/);
  key(view, 'e'); assert.equal(view.actions.form.values.title, 'Task today');
  key(view, 'escape'); key(view, 'escape');
  key(view, '/'); view.handle('later', {}); key(view, 'return');
  assert.equal(view.visible().length, 1);
  assert.match(view.lines(23, 118).join('\n'), /Upcoming \(1\)/);
  key(view, 'escape'); key(view, 's');
  assert.ok(view.visible().every(item => !item.completed));
});

test('completion and date edits move the selected card to its new lane', async () => {
  let tasks = fixtures();
  const view = new TasksView(() => {}, async () => ({ lists: ['Work'], tasks, errors: [] }),
    async (_operation, target, changes) => { tasks = tasks.map(item => item.id === target.id ? { ...item, ...changes } : item); });
  await view.reload(); view.lines(23, 118);
  const target = view.visible()[view.cursor];
  await view.actions.save('task.setCompleted', target, { completed: true });
  assert.equal(view.visible()[view.cursor].id, target.id);
  assert.match(view.lines(23, 118).join('\n'), /Completed \(2\)/);
  await view.actions.save('task.update', view.visible()[view.cursor], { completed: false, dueDate: '2999-01-02' });
  assert.equal(view.visible()[view.cursor].id, target.id);
  const selectedLane = boardLanes(view.visible()).find(lane => lane.items.some(item => item.index === view.cursor));
  assert.equal(selectedLane.title, 'Upcoming');
});
