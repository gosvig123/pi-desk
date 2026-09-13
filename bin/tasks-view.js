'use strict';

const { ALL_LISTS, TASK_STATUSES, safeText, loadTasks, filterTasks } = require('./tasks-data');
const { TaskActions } = require('./task-actions');
const { TasksListPicker } = require('./tasks-list-picker');
const { clip } = require('./task-layout');
const { taskRows, taskSummary, detailRows } = require('./task-presentation');
const { styleTaskRow } = require('./task-styles');
const { boardRows } = require('./task-board');
const { MIN_BOARD_WIDTH, moveOnBoard } = require('./task-board-model');
const OPEN_LIST_PICKER = 'l';
const NEXT_STATUS = 's';
const PREVIOUS_LIST = '[';
const NEXT_LIST = ']';
const START_CONVERSATION = 'c';
const CLOSED = 'closed';
const SEARCH = 'search';
const DETAILS = 'details';

class TasksView {
  constructor(refresh, load = loadTasks, mutate, hooks = {}) {
    this.refresh = refresh;
    this.actions = new TaskActions(this, mutate);
    this.load = load;
    this.hooks = hooks;
    this.data = { lists: [], tasks: [], errors: [] };
    this.listIndex = 0;
    this.statusIndex = 0;
    this.query = '';
    this.cursor = 0;
    this.mode = CLOSED;
    this.detailOffset = 0;
    this.started = false;
    this.loading = false;
  }

  async reload(background = false) {
    if (this.loading) return;
    if (!background) this.actions.error = '';
    const firstLoad = !this.started;
    this.started = true;
    this.loading = true;
    const selectedTask = this.visible()[this.cursor];
    const previousCursor = this.cursor;
    const selected = this.data.lists[this.listIndex - 1];
    let data;
    try { data = await this.load(); }
    catch (error) { data = { lists: [], tasks: [], errors: [safeText(error.message)] }; }
    if (background && (this.picker || this.actions.form || this.actions.saving || this.mode === 'search')) {
      this.loading = false;
      return;
    }
    this.data = data;
    const preferred = firstLoad ? this.data.currentList : selected;
    this.listIndex = preferred ? Math.max(0, this.data.lists.indexOf(preferred) + 1) : 0;
    this.picker = null;
    const index = this.visible().findIndex(task => task.id === selectedTask?.id && task.list === selectedTask?.list);
    this.cursor = index >= 0 ? index : Math.min(previousCursor, Math.max(0, this.visible().length - 1));
    this.loading = false;
    this.refresh();
  }

  visible() {
    return filterTasks(this.data.tasks, this.data.lists[this.listIndex - 1] ?? null,
      this.query, TASK_STATUSES[this.statusIndex]);
  }

  handleSearch(str, key) {
    if (key.name === 'return') this.mode = CLOSED;
    else if (key.name === 'escape') { this.query = ''; this.mode = CLOSED; }
    else if (key.name === 'backspace') this.query = [...this.query].slice(0, -1).join('');
    else if (key.ctrl && key.name === 'u') this.query = '';
    else if (str && !key.ctrl && !key.meta) this.query += safeText(str);
    this.cursor = 0;
    return true;
  }

  handle(str, key) {
    const k = key.name;
    if (key.ctrl && k === 'c') return false;
    if (this.actions.form || this.actions.saving) return this.actions.handle(str, key);
    if (k === 'tab') { this.picker = null; this.mode = CLOSED; return false; }
    if (this.picker) return this.handlePicker(str, key);
    if (this.mode === SEARCH) return this.handleSearch(str, key);
    if (this.actions.handle(str, key)) return true;
    if (this.mode === DETAILS) return this.handleDetails(k);
    if (moveOnBoard(this, k)) return true;
    if (['left', 'right', 'h'].includes(k)) return false;
    if (k === OPEN_LIST_PICKER) {
      this.picker = new TasksListPicker(this.data.lists, this.listIndex);
      return true;
    }
    if (k === 'q' || k === 'escape') {
      if (!this.query) return false;
      this.query = ''; this.cursor = 0; return true;
    }
    return this.handleListAction(str, k);
  }

  handleDetails(k) {
    if (['escape', 'q', 'd', 'return'].includes(k)) this.mode = CLOSED;
    else if (['down', 'j', 'pagedown'].includes(k)) this.detailOffset += k === 'pagedown' ? 5 : 1;
    else if (['up', 'k', 'pageup'].includes(k)) this.detailOffset = Math.max(0, this.detailOffset - (k === 'pageup' ? 5 : 1));
    else if (k === START_CONVERSATION && this.startable()) {
      this.mode = CLOSED;
      this.hooks.startConversation(this.visible()[this.cursor]);
    }
    return true;
  }

  // The selected task, when a conversation can be started for it.
  startable() {
    return Boolean(this.hooks.startConversation) && Boolean(this.visible()[this.cursor]);
  }

  linked(task) {
    return task && this.hooks.linkedConversations ? this.hooks.linkedConversations(task.id) : [];
  }

  handleListAction(str, k) {
    if (str === PREVIOUS_LIST || str === NEXT_LIST) {
      const count = this.data.lists.length + 1;
      this.listIndex = (this.listIndex + (str === NEXT_LIST ? 1 : count - 1)) % count;
      this.cursor = 0;
    } else this.handleAction(str, k);
    return true; // Session actions must never receive task rows.
  }

  handlePicker(str, key) {
    const result = this.picker.handle(str, key);
    if (result?.index !== undefined) { this.listIndex = result.index; this.cursor = 0; }
    if (result) this.picker = null;
    return true;
  }

  handleAction(str, k) {
    const last = Math.max(0, this.visible().length - 1);
    if (k === 'up' || k === 'k') this.cursor = Math.max(0, this.cursor - 1);
    else if (k === 'down' || k === 'j') this.cursor = Math.min(last, this.cursor + 1);
    else if (k === 'home') this.cursor = 0;
    else if (k === 'end') this.cursor = last;
    else if (k === 'pageup') this.cursor = Math.max(0, this.cursor - 10);
    else if (k === 'pagedown') this.cursor = Math.min(last, this.cursor + 10);
    else if (str === NEXT_STATUS) {
      this.statusIndex = (this.statusIndex + 1) % TASK_STATUSES.length;
      this.cursor = 0;
    }
    else if (str === '/') this.mode = SEARCH;
    else if (k === 'r') void this.reload();
    else if (k === START_CONVERSATION && this.startable()) this.hooks.startConversation(this.visible()[this.cursor]);
    else if ((k === 'd' || k === 'return') && this.visible()[this.cursor]) { this.mode = DETAILS; this.detailOffset = 0; }
  }

  lines(height, width = 78, styled = false) {
    this.boardActive = width >= MIN_BOARD_WIDTH && height >= 11 && this.visible().length > 0;
    if (!this.started) void this.reload();
    if (this.picker) return this.picker.lines(height).map(row => clip(row, width));
    if (this.actions.form) return this.actions.lines(height, width).slice(-height).map(row => clip(row, width));
    const list = safeText(this.data.lists[this.listIndex - 1] ?? ALL_LISTS);
    const rows = [...this.actions.lines(), `List: ${list} · ${TASK_STATUSES[this.statusIndex].label}`,
      taskSummary(this),
      this.query || this.mode === SEARCH ? `Search: /${this.query}${this.mode === SEARCH ? '▏' : ''}` : '/ search · l lists · s status'];
    if (this.loading) rows.push('Loading tasks…');
    if (this.data.errors.length) rows.push(`Error: ${this.data.errors.join('; ')} — r retries`);
    const available = Math.max(1, height - rows.length);
    this.boardActive &&= available >= 8;
    const content = this.contentLines(available, width, styled);
    return [...rows.slice(0, Math.max(0, height - 1)).map(row => clip(row, width)), ...content].slice(0, height);
  }

  contentLines(height, width, styled) {
    if (this.mode === DETAILS) return this.detailLines(width, height);
    return this.boardActive ? boardRows(this, height, width, styled) : taskRows(this, height, width);
  }

  renderLines(height, width) {
    const rows = this.lines(height, width, true);
    if (this.actions.form || this.picker || this.mode === DETAILS || this.boardActive) return rows;
    return rows.map(row => styleTaskRow(row, width));
  }

  detailLines(width = 78, height = 1000) {
    const task = this.visible()[this.cursor];
    const rows = detailRows(task, width, this.linked(task));
    this.detailOffset = Math.min(this.detailOffset, Math.max(0, rows.length - height));
    return rows.slice(this.detailOffset, this.detailOffset + height);
  }

  help(width = 78) {
    if (this.actions.form) return this.actions.help();
    if (this.picker) return 'Type list name · ↑↓ select · Enter apply · Esc cancel · Tab tabs';
    if (this.mode === SEARCH) return 'Type search · Enter apply · Esc clear · Ctrl-U clear';
    if (width < 60) return this.mode === DETAILS ? '↑↓ scroll · e edit · c conversation · Esc back' : '↑↓ move · Enter info · Space toggle';
    if (this.mode === DETAILS) return '↑↓ scroll · e edit · Space toggle · c conversation · Esc back';
    if (this.boardActive || width < 100) return 'Enter info · Space toggle · e edit · n add · c conversation · s status · r reload';
    return `↑↓ move · Enter details · Space toggle · e edit · n add · l lists · ${START_CONVERSATION} conversation · ${NEXT_STATUS} status · / search · r reload · q quit`;
  }
}

module.exports = { TasksView };
