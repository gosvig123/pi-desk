'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskLinkPicker, applyTaskLinkChoice } = require('../bin/task-link-picker');
const { displayWidth } = require('../bin/task-layout');
const { stripVTControlCharacters } = require('node:util');

const palette = { clr: '', R: '', B: '', D: '', I: '', cyn: '', mag: '', red: '', gry: '', bgBlu: '' };
const task = (id, extra = {}) => ({ id, title: id, list: 'work', completed: false,
  dueDate: '', description: '', subtasks: [], ...extra });
const view = session => new TaskLinkPicker(session, {
  palette,
  loadTasks: async () => ({ tasks: [task('Ship it'), task('Fix build', { list: 'today' })], errors: [] }),
  taskIndex: () => new Map(),
  refresh: () => {},
});

test('a saved choice updates through the save function and reports the task', () => {
  const saved = [];
  const pending = task('Ship it');
  assert.equal(applyTaskLinkChoice((id, link) => saved.push([id, link]), 'session-1', { task: pending }, new Map()),
    'linked to task: Ship it');
  assert.deepEqual(saved, [['session-1', pending]]);
});

test('a failed save is reported and never claims success', () => {
  const failed = () => { throw new Error('could not save task links: EACCES; check that the directory is writable (/tmp/x)'); };
  const notice = applyTaskLinkChoice(failed, 'session-1', { task: task('Ship it') }, new Map());
  assert.match(notice, /^task link not saved: /);
  assert.match(notice, /EACCES/);
  assert.doesNotMatch(notice, /linked to task/);
});

test('detaching reports removal only after the save succeeds', () => {
  const saved = [];
  assert.equal(applyTaskLinkChoice((id, link) => saved.push([id, link]), 'session-1', { detach: true }, new Map()),
    'task link removed');
  assert.deepEqual(saved, [['session-1', null]]);
  const failed = () => { throw new Error('disk full'); };
  assert.match(applyTaskLinkChoice(failed, 'session-1', { detach: true }, new Map()), /^task link not saved: disk full$/);
});

test('the screen shows loading, the linked task, rows, and load errors', async () => {
  const session = { id: 's', title: 'Fix build', task: { id: 'Ship it', title: 'Old name', list: 'work' } };
  const picker = view(session);
  assert.match(picker.screen(80, 24), /Loading tasks/);
  picker.start();
  await new Promise(resolve => setImmediate(resolve));
  const screen = picker.screen(80, 24);
  assert.match(screen, /associate conversation with a task/);
  assert.match(screen, /Fix build/);
  assert.match(screen, /Old name/);
  assert.match(screen, /\[ \] Ship it/);
  assert.match(screen, /— no task —/);
  assert.match(screen, /Enter apply/);
  assert.deepEqual(picker.handle('', { name: 'escape' }), { cancelled: true });
});

test('a tasks CLI failure stays on screen and blocks nothing else', async () => {
  const picker = new TaskLinkPicker({ id: 's', title: 'Title' }, {
    palette,
    loadTasks: async () => { throw new Error('tasks CLI not found on PATH'); },
    taskIndex: () => new Map(),
    refresh: () => {},
  });
  picker.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(picker.screen(80, 24), /tasks CLI not found on PATH/);
  assert.equal(picker.picker.error, 'tasks CLI not found on PATH');
  assert.equal(picker.handle('', { name: 'return' }), null);
});

test('every screen line fits narrow terminals and short heights', async () => {
  const picker = view({ id: 's', title: '界'.repeat(40), task: { id: 'Ship it', title: 'Ship it' } });
  picker.start();
  await new Promise(resolve => setImmediate(resolve));
  for (const width of [24, 40, 78, 120]) for (const height of [6, 12, 30]) {
    const lines = picker.screen(width, height).split('\n').filter(Boolean);
    for (const line of lines) {
      assert.ok(displayWidth(stripVTControlCharacters(line)) <= width, `${width}: ${line}`);
    }
  }
});
