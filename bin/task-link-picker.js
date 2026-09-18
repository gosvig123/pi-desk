'use strict';

const { TaskPicker } = require('./task-picker');
const { taskOptionLabel } = require('./task-presentation');
const { taskTitle } = require('./task-link-meta');
const { displayWidth, ellipsize, clip } = require('./task-layout');

// Conversation side of the task link: the picker model, its full-screen view,
// and the apply step that reports a failed save instead of claiming success.
//
// Options: palette (ANSI palette), loadTasks (tasks CLI read), taskIndex
// (live task lookup), refresh (repaint callback).
class TaskLinkPicker {
  constructor(session, options) {
    this.session = session;
    this.picker = new TaskPicker(session.task ? session.task.id : '');
    this.palette = options.palette;
    this.loadTasks = options.loadTasks;
    this.taskIndex = options.taskIndex;
    this.refresh = options.refresh;
    this.started = false;
  }

  handle(str, key) { return this.picker.handle(str, key); }

  // One tasks CLI read per open. A failure stays on screen with the tasks CLI
  // message, so the user can fix the CLI or cancel.
  start() {
    if (this.started) return;
    this.started = true;
    Promise.resolve()
      .then(() => this.loadTasks())
      .then(result => this.loaded(result.tasks, result.errors.join('; ')), error => this.loaded([], error.message));
  }

  loaded(tasks, error) {
    this.picker.setTasks(tasks);
    if (error) this.picker.setError(error);
    this.refresh();
  }

  render(stream = process.stdout) {
    stream.write(this.screen(stream.columns || 100, stream.rows || 30));
  }

  screen(width, height) {
    const A = this.palette;
    const text = Math.max(1, width - 12);
    const header = clip('pi-desk  associate conversation with a task', Math.max(1, width - 1));
    const lines = [A.clr + ' ' + A.B + A.cyn + header + A.R, ''];
    lines.push(` ${A.D}session${A.R}  ${ellipsize(this.session.title, text)}`);
    lines.push(` ${A.D}task${A.R}     ${this.linkLabel(text)}`);
    if (this.picker.error) lines.push(` ${A.red}${ellipsize(`tasks: ${this.picker.error}`, width - 4)}${A.R}`);
    lines.push(` ${A.D}filter${A.R} ${A.cyn}${ellipsize(this.picker.query, text)}${A.R}${this.picker.query ? A.I + ' ' + A.R : ''}`);
    lines.push(A.gry + '─'.repeat(Math.max(1, width - 1)) + A.R);
    lines.push(...this.rows(width - 1, Math.max(3, height - lines.length - 3)));
    lines.push(A.gry + '─'.repeat(Math.max(1, width - 1)) + A.R);
    lines.push(' ' + A.D + clip('↑↓ select · Enter apply · Esc cancel', Math.max(1, width - 2)) + A.R);
    return lines.join('\n') + '\n';
  }

  linkLabel(width) {
    const link = this.session.task;
    if (!link) return `${this.palette.gry}(none)${this.palette.R}`;
    return `${this.palette.mag}${ellipsize(taskTitle(link, this.taskIndex()), width)}${this.palette.R}`;
  }

  rows(width, usable) {
    const A = this.palette;
    if (this.picker.loading) return [' ' + A.D + 'Loading tasks…' + A.R];
    const options = this.picker.visible();
    this.picker.cursor = Math.min(this.picker.cursor, Math.max(0, options.length - 1));
    const start = Math.max(0, Math.min(this.picker.cursor - Math.floor(usable / 2), options.length - usable));
    const rows = [];
    for (let index = start; index < Math.min(options.length, start + usable); index++) {
      rows.push(this.row(options[index], index === this.picker.cursor, width));
    }
    return rows.length ? rows : [' ' + A.D + '(no tasks match)' + A.R];
  }

  row(option, selected, width) {
    const A = this.palette;
    const label = option.detach ? '— no task —' : taskOptionLabel(option.task, width - 4);
    const text = ` ${selected ? A.cyn + '▶' + A.R : ' '} ${label}`;
    return selected ? A.bgBlu + text + ' '.repeat(Math.max(0, width - screenWidth(text))) + A.R : text;
  }
}

function screenWidth(text) {
  return displayWidth(text.replace(/\x1b\[[0-9;]*m/g, ''));
}

// Persist one picker result and return the footer notice. A failed save never
// reads as success, and the caller keeps the previous link in memory.
function applyTaskLinkChoice(save, sessionId, result, index) {
  try {
    save(sessionId, result.detach ? null : result.task);
  } catch (error) {
    return `task link not saved: ${error.message}`;
  }
  if (result.detach) return 'task link removed';
  return `linked to task: ${taskTitle(result.task, index)}`;
}

module.exports = { TaskLinkPicker, applyTaskLinkChoice };
