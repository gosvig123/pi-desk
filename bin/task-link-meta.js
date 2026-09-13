'use strict';

// Display metadata for conversation → task links.
//
// A link stores a task id plus a title/list fallback. Once the Tasks tab has
// loaded tasks, the live task record wins everywhere (rows, search, details), so
// a renamed task or a task moved to another list shows its current values.
const { ellipsize } = require('./task-layout');

function taskIndex(tasks = []) {
  return new Map((tasks || []).map(task => [task.id, task]));
}

function liveTask(link, index) {
  return link && index ? index.get(link.id) : undefined;
}

function taskTitle(link, index) {
  const task = liveTask(link, index);
  return (task && task.title) || link.title || link.id;
}

function taskListName(link, index) {
  const task = liveTask(link, index);
  return (task && task.list) || link.list || 'unknown list';
}

// Search text for the conversation row, so a renamed task stays findable.
function taskSearchText(link, index) {
  return link ? `${taskTitle(link, index)} ${taskListName(link, index)}`.toLowerCase() : '';
}

// Styled chip for the conversations list. `palette` is pi-desk's ANSI palette.
function taskChip(link, index, palette, width = 16) {
  if (!link) return '';
  return `${palette.mag}▸${ellipsize(taskTitle(link, index), width)}${palette.R} `;
}

// Details rows as [key, value] pairs for the caller's row helper. Values are
// pre-colored, so the caller passes its default color.
function taskDetailRows(link, index, palette, width) {
  const text = Math.max(8, width - 20);
  if (!link) {
    return [['task', `${palette.gry}(none — t to associate)${palette.R}`]];
  }
  const title = `${palette.mag}${ellipsize(taskTitle(link, index), text)}${palette.R}`;
  return [
    ['task', `${title}${palette.gry}  (${taskListName(link, index)})${palette.R}`],
    ['task id', `${palette.gry}${link.id}${palette.R}`],
  ];
}

// Conversations already linked to one task, for the Tasks tab details.
function conversationsForTask(sessions, taskId) {
  return sessions
    .filter(session => session.task && session.task.id === taskId)
    .map(session => ({ id: session.id, title: session.title }));
}

module.exports = { taskIndex, taskTitle, taskListName, taskSearchText, taskChip, taskDetailRows, conversationsForTask };
