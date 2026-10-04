'use strict';

// Model for the floating task panel: one tasks list or one opened task.
// Rendering helpers (fit, wrap, paint) come from the host so this file stays
// free of TUI dependencies and runs under node --test.
const { filterTasks, ALL_STATUSES } = require('./tasks-data');

const PANEL_OVERHEAD = 6;
const MIN_PANEL_HEIGHT = 7;
const MAX_ROWS = 14;
const UNFOCUS = 'unfocus';
const HIDE = 'hide';
const TOGGLE = 'toggle';
const SET_LIST = 'setList';

function listTasks(tasks, list) {
  return filterTasks(tasks, list, '', ALL_STATUSES)
    .sort((left, right) => Number(left.completed) - Number(right.completed));
}

class TaskPanelModel {
  constructor() {
    this.data = { lists: [], tasks: [], errors: [], currentList: null };
    this.listIndex = 0;
    this.selected = 0;
    this.openId = null;
    this.scroll = 0;
    this.error = '';
    this.linkedShown = null;
    this.saving = false;
  }

  setData(data, linkedId = null) {
    const firstLoad = this.data.lists.length === 0;
    const previousList = this.list();
    this.data = data;
    this.error = '';
    const keep = data.lists.indexOf(previousList);
    this.listIndex = keep >= 0 && !firstLoad ? keep : Math.max(0, data.lists.indexOf(data.currentList));
    // Open the conversation's linked task once per link, not on every refresh.
    const linked = linkedId && data.tasks.find(task => task.id === linkedId);
    if (linked && this.linkedShown !== linkedId) {
      this.linkedShown = linkedId;
      this.listIndex = Math.max(0, data.lists.indexOf(linked.list));
      this.openId = linked.id;
      this.scroll = 0;
    }
    if (this.openId && !data.tasks.some(task => task.id === this.openId)) this.openId = null;
    this.selected = Math.min(this.selected, Math.max(0, this.tasks().length - 1));
  }

  setError(message) { this.error = message; }
  list() { return this.data.lists[this.listIndex] ?? null; }
  tasks() { return this.list() === null ? [] : listTasks(this.data.tasks, this.list()); }
  openTask() { return this.data.tasks.find(task => task.id === this.openId) ?? null; }

  // Returns an action when the host must change panel state or task data:
  // UNFOCUS, HIDE, { type: TOGGLE, task }, or { type: SET_LIST, list }.
  handle(key) {
    if (key === 'q') return HIDE;
    if (key === 'space') return this.toggle();
    if (this.openTask()) return this.handleTask(key);
    const count = this.tasks().length;
    if (key === 'escape') return UNFOCUS;
    if (key === 'up') this.selected = Math.max(0, this.selected - 1);
    if (key === 'down') this.selected = Math.min(Math.max(0, count - 1), this.selected + 1);
    if (key === 'left' || key === 'right') return this.moveList(key === 'left' ? -1 : 1);
    if (key === 'enter' && count > 0) {
      this.openId = this.tasks()[this.selected].id;
      this.scroll = 0;
    }
    return null;
  }

  toggle() {
    const task = this.openTask() ?? this.tasks()[this.selected];
    return task && !this.saving ? { type: TOGGLE, task } : null;
  }

  handleTask(key) {
    if (key === 'escape') this.openId = null;
    if (key === 'up') this.scroll = Math.max(0, this.scroll - 1);
    if (key === 'down') this.scroll++;
    return null;
  }

  moveList(step) {
    const count = this.data.lists.length;
    if (count === 0) return null;
    this.listIndex = (this.listIndex + step + count) % count;
    this.selected = 0;
    return { type: SET_LIST, list: this.list() };
  }

  preferredHeight(width, ui) {
    const rows = this.openTask() ? this.taskBody(width - 2, ui).length : Math.max(1, this.tasks().length);
    return PANEL_OVERHEAD + Math.min(MAX_ROWS, rows);
  }

  taskBody(inner, ui) {
    const task = this.openTask();
    const meta = [task.list, task.dueDate && `due ${task.dueDate}`, task.completed ? 'completed' : 'pending'];
    const lines = [ui.paint('dim', ` ${meta.filter(Boolean).join(' · ')}`)];
    if (task.description) lines.push('', ...ui.wrap(task.description, inner - 2).map(line => ` ${line}`));
    if (task.subtasks.length > 0) lines.push('', ui.paint('dim', ' Subtasks'));
    for (const item of task.subtasks) lines.push(` ${item.completed ? ui.paint('success', '✓') : '○'} ${item.title}`);
    return lines;
  }

  listRows(capacity, ui) {
    const tasks = this.tasks();
    if (tasks.length === 0) return [ui.paint('dim', ' No tasks in this list')];
    const start = Math.min(Math.max(0, this.selected - capacity + 1), Math.max(0, tasks.length - capacity));
    return tasks.slice(start, start + capacity).map((task, offset) => {
      const index = start + offset;
      const mark = index === this.selected ? ui.paint('accent', '▸') : ' ';
      const title = task.completed ? ui.paint('dim', `✓ ${task.title}`) : task.title;
      const due = task.dueDate ? ui.paint('dim', `  ${task.dueDate}`) : '';
      return ` ${mark} ${title}${due}`;
    });
  }

  header() {
    const task = this.openTask();
    const saving = this.saving ? ' · saving…' : '';
    if (task) return ` TASK · ${task.completed ? '✓ ' : ''}${task.title}${saving}`;
    const pending = this.tasks().filter(item => !item.completed).length;
    return ` TASKS · ${this.list() ?? 'no lists'} · ${pending} pending${saving}`;
  }

  footer(focused) {
    if (!focused) return ' ctrl+alt+t focus · /desk-panel hide';
    if (this.openTask()) return ' ↑↓ scroll · space done · esc back · q hide';
    return ' ↑↓ move · ←→ list · space done · ⏎ open · esc editor · q hide';
  }

  render(width, maxHeight, ui, focused) {
    if (width < 2) return [' '.repeat(Math.max(0, width))];
    const inner = width - 2;
    const capacity = Math.max(1, maxHeight - PANEL_OVERHEAD);
    let body;
    if (this.error) body = ui.wrap(this.error, inner - 2).map(line => ui.paint('error', ` ${line}`));
    else if (this.openTask()) {
      const lines = this.taskBody(inner, ui);
      this.scroll = Math.min(this.scroll, Math.max(0, lines.length - capacity));
      body = lines.slice(this.scroll, this.scroll + capacity);
    } else body = this.listRows(capacity, ui);
    const border = text => ui.paint(focused ? 'accent' : 'border', text);
    const row = text => border('│') + ui.fit(text, inner) + border('│');
    const rule = border(`├${'─'.repeat(inner)}┤`);
    return [
      border(`╭${'─'.repeat(inner)}╮`), row(this.header()), rule,
      ...body.slice(0, capacity).map(row), rule,
      row(ui.paint('dim', this.footer(focused))), border(`╰${'─'.repeat(inner)}╯`),
    ];
  }
}

module.exports = { TaskPanelModel, MIN_PANEL_HEIGHT, UNFOCUS, HIDE, TOGGLE, SET_LIST };
