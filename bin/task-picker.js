'use strict';

const { safeText, filterTasks } = require('./tasks-data');

// Picker model for associating one conversation with one task.
//
// Rows are { task } entries from the tasks CLI plus, for a linked conversation
// with an empty filter, a leading { detach: true } row that clears the link. The
// tasks load is asynchronous, so `tasks` stays null while loading.
class TaskPicker {
  constructor(linkedTaskId = '', tasks = null) {
    this.linkedTaskId = linkedTaskId;
    this.tasks = tasks;
    this.query = '';
    this.cursor = 0;
    this.error = '';
  }

  get loading() { return this.tasks === null; }

  setTasks(tasks) {
    this.tasks = tasks;
    this.cursor = this.defaultCursor();
  }

  setError(message) { this.error = safeText(message); }

  // The detach row belongs to the unfiltered list only, so typing a filter can
  // never turn Enter into an accidental unlink.
  visible() {
    if (this.tasks === null) return [];
    const tasks = filterTasks(this.tasks, null, this.query).map(task => ({ task }));
    return this.linkedTaskId && !this.query ? [{ detach: true, label: 'No task' }, ...tasks] : tasks;
  }

  defaultCursor() {
    if (!this.linkedTaskId) return 0;
    return Math.max(0, this.visible().findIndex(row => row.task && row.task.id === this.linkedTaskId));
  }

  last() { return Math.max(0, this.visible().length - 1); }

  // The highlighted row, clamped when a filter shrank the list.
  current() {
    const rows = this.visible();
    this.cursor = Math.min(this.cursor, Math.max(0, rows.length - 1));
    return rows[this.cursor];
  }

  // Returns { task } to link, { detach: true } to clear, { cancelled: true } to
  // close, or null when the key only moved the cursor or edited the filter.
  handle(str, key) {
    const k = key.name;
    if (k === 'escape') return { cancelled: true };
    if (k === 'return') {
      const row = this.current();
      return row ? (row.detach ? { detach: true } : { task: row.task }) : null;
    }
    if (k === 'up') this.cursor = Math.max(0, this.cursor - 1);
    else if (k === 'down') this.cursor = Math.min(this.last(), this.cursor + 1);
    else if (k === 'pageup') this.cursor = Math.max(0, this.cursor - 10);
    else if (k === 'pagedown') this.cursor = Math.min(this.last(), this.cursor + 10);
    else if (k === 'backspace') { this.query = [...this.query].slice(0, -1).join(''); this.cursor = 0; }
    else if (key.ctrl && k === 'u') { this.query = ''; this.cursor = 0; }
    else if (str && !key.ctrl && !key.meta) { this.query += safeText(str); this.cursor = 0; }
    return null;
  }
}

module.exports = { TaskPicker };
