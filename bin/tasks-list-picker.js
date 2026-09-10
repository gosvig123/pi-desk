'use strict';

const { ALL_LISTS, safeText } = require('./tasks-data');

class TasksListPicker {
  constructor(lists, selectedIndex) {
    this.options = [ALL_LISTS, ...lists].map((label, index) => ({ label: safeText(label), index }));
    this.query = '';
    this.cursor = selectedIndex;
  }

  visible() {
    return this.options.filter(option => option.label.toLowerCase().includes(this.query.toLowerCase()));
  }

  handle(str, key) {
    const options = this.visible();
    if (key.name === 'escape') return { cancelled: true };
    if (key.name === 'return') return options[this.cursor] ? { index: options[this.cursor].index } : null;
    if (key.name === 'up') this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === 'down') this.cursor = Math.min(Math.max(0, options.length - 1), this.cursor + 1);
    else {
      if (key.name === 'backspace') this.query = [...this.query].slice(0, -1).join('');
      else if (key.ctrl && key.name === 'u') this.query = '';
      else if (str && !key.ctrl && !key.meta) this.query += safeText(str);
      this.cursor = 0;
    }
    return null;
  }

  lines(height) {
    const options = this.visible();
    const count = Math.max(1, height - 2);
    const start = Math.max(0, this.cursor - Math.floor(count / 2));
    return [`Choose list: ${this.query}▏`, ...(options.length
      ? options.slice(start, start + count).map((option, offset) =>
        `${start + offset === this.cursor ? '▶' : ' '} ${option.label}`)
      : ['(no lists match)'])];
  }
}

module.exports = { TasksListPicker };
