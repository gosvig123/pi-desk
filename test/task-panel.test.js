'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskPanelModel, UNFOCUS, HIDE, TOGGLE, SET_LIST } = require('../bin/task-panel');

const ui = { paint: (_color, text) => text, fit: (text, width) => text.slice(0, width).padEnd(width), wrap: text => [text] };
const task = (id, list, extra = {}) => ({ id, title: id, list, completed: false, dueDate: '', description: '', subtasks: [], ...extra });
const data = {
  lists: ['today', 'work'], currentList: 'work', errors: [],
  tasks: [task('Ship', 'work', { description: 'Release notes', subtasks: [task('Tag', 'work')] }),
    task('Old', 'work', { completed: true }), task('Call', 'today')],
};
const text = (model, focused = true) => model.render(60, 20, ui, focused).join('\n');

test('panel opens on the current list with pending tasks first', () => {
  const model = new TaskPanelModel();
  model.setData(data);
  const output = text(model);
  assert.match(output, /TASKS · work · 1 pending/);
  assert.ok(output.indexOf('▸ Ship') < output.indexOf('✓ Old'));
});

test('arrows, enter, and escape navigate between list and task', () => {
  const model = new TaskPanelModel();
  model.setData(data);
  model.handle('enter');
  assert.match(text(model), /TASK · Ship[\s\S]*Release notes[\s\S]*○ Tag/);
  assert.equal(model.handle('escape'), null);
  assert.match(text(model), /TASKS · work/);
  assert.equal(model.handle('escape'), UNFOCUS);
  assert.deepEqual(model.handle('right'), { type: SET_LIST, list: 'today' });
  assert.match(text(model), /TASKS · today · 1 pending[\s\S]*▸ Call/);
  assert.equal(model.handle('q'), HIDE);
});

test('linked task opens once, then refreshes keep the user view', () => {
  const model = new TaskPanelModel();
  model.setData(data, 'Call');
  assert.match(text(model), /TASK · Call/);
  model.handle('escape');
  model.setData(data, 'Call');
  assert.match(text(model), /TASKS · today/);
});

test('unfocused panel tells the user how to focus it again', () => {
  const model = new TaskPanelModel();
  model.setData(data);
  assert.match(text(model, false), /ctrl\+alt\+t focus/);
  model.setError('tasks CLI not found on PATH');
  assert.match(text(model), /tasks CLI not found on PATH/);
});

test('space asks to toggle the selected or opened task, not while saving', () => {
  const model = new TaskPanelModel();
  model.setData(data);
  model.handle('down');
  assert.deepEqual(model.handle('space'), { type: TOGGLE, task: data.tasks[1] });
  model.handle('up');
  model.handle('enter');
  assert.deepEqual(model.handle('space'), { type: TOGGLE, task: data.tasks[0] });
  model.saving = true;
  assert.equal(model.handle('space'), null);
  assert.match(text(model), /saving…/);
});
