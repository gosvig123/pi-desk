'use strict';

const { TaskForm } = require('./task-form');
const { mutateTask } = require('./tasks-mutations');
const { safeText } = require('./tasks-data');

class TaskActions {
  constructor(view, mutate = mutateTask) {
    this.view = view;
    this.mutate = mutate;
    this.form = null;
    this.saving = false;
    this.error = '';
  }

  handle(str, key) {
    if (this.saving) return true;
    if (this.form) {
      const result = this.form.handle(str, key);
      if (result?.cancelled) this.form = null;
      else if (result?.changes) void this.save(this.form.creating ? 'task.create' : 'task.update',
        this.form.target, result.changes);
      return true;
    }
    if (!['n', 'e', 'space'].includes(key.name) && str !== ' ') return false;
    if (this.view.loading) return true;
    const task = this.view.visible()[this.view.cursor];
    if (key.name === 'n') this.startCreate();
    else if (task && key.name === 'e') this.form = new TaskForm(task, false);
    else if (task) void this.save('task.setCompleted', task, { completed: !task.completed });
    return true;
  }

  startCreate() {
    const { data, listIndex } = this.view;
    const list = data.lists[listIndex - 1] ?? data.currentList;
    if (!list || !data.revisions?.[list]) {
      this.error = 'Choose a loaded list with l before adding a task';
      return;
    }
    this.error = '';
    this.form = new TaskForm({ list, revision: data.revisions[list] }, true);
  }

  async save(operation, target, changes) {
    this.saving = true;
    this.error = '';
    this.view.refresh();
    try {
      await this.mutate(operation, target, changes);
      this.form = null;
      await this.view.reload();
    } catch (error) { this.error = `${operation}: ${safeText(error.message)}`; }
    finally { this.saving = false; this.view.refresh(); }
  }

  lines(height, width) {
    return [...(this.form?.lines(height, width) || []), ...(this.saving ? ['Saving task…'] : []),
      ...(this.error ? [`Error: ${this.error}`] : [])];
  }

  help() {
    return this.form ? 'Tab fields · Ctrl-S save · Esc cancel' : '';
  }
}

module.exports = { TaskActions };
