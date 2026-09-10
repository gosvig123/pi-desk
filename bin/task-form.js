'use strict';

const { safeText } = require('./tasks-data');
const { segments, clip, viewport } = require('./task-layout');
const FIELDS = ['title', 'dueDate', 'description'];
const LABELS = ['Title', 'Due date (YYYY-MM-DD, blank clears)', 'Description'];

class TaskForm {
  constructor(target, creating) {
    this.target = target;
    this.creating = creating;
    this.index = 0;
    this.values = { title: target.editValues?.title ?? target.title ?? '',
      dueDate: target.dueDate || '', description: target.editValues?.description ?? target.description ?? '' };
    this.positions = Object.fromEntries(FIELDS.map(field => [field, segments(this.values[field]).length]));
    this.error = '';
  }

  handle(str, key) {
    if (key.name === 'escape') return { cancelled: true };
    if (key.ctrl && key.name === 's') return this.submit();
    if (key.name === 'return' && this.index === FIELDS.length) return this.submit();
    if (['tab', 'down', 'up', 'return'].includes(key.name)) {
      const backwards = key.shift || key.name === 'up';
      this.index = (this.index + (backwards ? FIELDS.length : 1)) % (FIELDS.length + 1);
    } else if (this.index < FIELDS.length) this.edit(str, key);
    return null;
  }

  edit(str, key) {
    const field = FIELDS[this.index];
    const chars = segments(this.values[field]);
    let pos = Math.min(this.positions[field], chars.length);
    if (key.name === 'left') pos = Math.max(0, pos - 1);
    else if (key.name === 'right') pos = Math.min(chars.length, pos + 1);
    else if (key.name === 'home') pos = 0;
    else if (key.name === 'end') pos = chars.length;
    else if (key.ctrl && key.name === 'u') { chars.length = 0; pos = 0; }
    else if (key.name === 'backspace' && pos) chars.splice(--pos, 1);
    else if (key.name === 'delete') chars.splice(pos, 1);
    else if (str && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f-\x9f]/.test(str)) {
      const added = segments(str); chars.splice(pos, 0, ...added); pos += added.length;
    }
    this.values[field] = chars.join('');
    this.positions[field] = pos;
    this.error = '';
  }

  submit() {
    if (!this.values.title.trim()) this.error = 'Title is required';
    else if (!validDate(this.values.dueDate)) this.error = 'Use a valid YYYY-MM-DD date or leave it blank';
    else return { changes: { ...this.values, title: this.values.title.trim() } };
    this.index = this.values.title.trim() ? 1 : 0;
    return null;
  }

  lines(height = 20, width = 78) {
    const title = `${this.creating ? 'Add' : 'Edit'} task · List: ${safeText(this.target.list)}`;
    const fields = FIELDS.flatMap((field, index) => [
      `${index === this.index ? '▶' : ' '} ${LABELS[index]}`,
      '  ' + (index === this.index ? viewport(this.values[field], this.positions[field], width - 2)
        : clip(this.values[field] || '(empty)', width - 2)),
      ...(this.error && index === this.index ? [`! ${this.error}`] : []), '']);
    fields.push(`${this.index === FIELDS.length ? '▶' : ' '} [ Save changes ]`);
    if (height < 5 && this.index < FIELDS.length) return [
      this.error ? `! ${this.error}` : LABELS[this.index],
      viewport(this.values[FIELDS[this.index]], this.positions[FIELDS[this.index]], width),
      'Ctrl-S save · Esc cancel'].slice(-height).map(row => clip(row, width));
    const focus = this.index * 3;
    const available = Math.max(1, height - 2);
    const start = Math.max(0, Math.min(focus, fields.length - available));
    return [title, ...fields.slice(start, start + available), 'Ctrl-S save · Esc cancel'].slice(-height)
      .map(row => clip(row, width));
  }

}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = { TaskForm };
