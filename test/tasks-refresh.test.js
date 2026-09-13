'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksView } = require('../bin/tasks-view');

test('background task refresh preserves a form opened while its read is in flight, including read errors', async () => {
  for (const fail of [false, true]) {
    let resolve, reject;
    const view = new TasksView(() => {}, () => new Promise((yes,no) => { resolve=yes; reject=no; }));
    const previous = view.data;
    const pending = view.reload(true);
    const form = { values: { title: 'Unsaved edit' } };
    view.actions.form = form;
    view.actions.error = 'Keep this user error';
    if (fail) reject(new Error('offline'));
    else resolve({ lists: [], tasks: [], errors: [] });
    await pending;
    assert.equal(view.data, previous);
    assert.equal(view.actions.form, form);
    assert.equal(view.actions.error, 'Keep this user error');
    assert.equal(view.loading, false);
  }
});
