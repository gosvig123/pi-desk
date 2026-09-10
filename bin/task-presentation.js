'use strict';
const { safeText } = require('./tasks-data');
const { clip, ellipsize, wrap } = require('./task-layout');

function dueLabel(task, now = new Date()) {
  if (!task.dueDate) return 'No due date';
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const state = task.completed ? 'Due' : task.dueDate < today ? 'Overdue' : task.dueDate === today ? 'Today' : 'Due';
  return `${state} ${task.dueDate}`;
}

function taskMetadata(task, showList) {
  const subtasks = task.subtasks || [];
  const progress = subtasks.length ? `${subtasks.filter(item => item.completed).length}/${subtasks.length} subtasks` : '';
  return [dueLabel(task), progress, showList ? safeText(task.list) : ''].filter(Boolean).join(' · ');
}

function taskSummary(view) {
  const tasks = view.visible();
  const completed = tasks.filter(task => task.completed).length;
  const position = tasks.length ? `${Math.min(view.cursor + 1, tasks.length)}/${tasks.length}` : '0/0';
  return `${position} · ${tasks.length - completed} pending · ${completed} completed`;
}

function taskRows(view, height, width) {
  const tasks = view.visible();
  if (!tasks.length) return [view.loading ? 'Loading tasks…' : 'No matching tasks.',
    'n add · l list · s status · / search'].slice(0, height).map(row => clip(row, width));
  view.cursor = Math.min(view.cursor, tasks.length - 1);
  const rowHeight = height >= 9 ? 3 : 2;
  const count = Math.max(1, Math.floor(height / rowHeight));
  const start = Math.max(0, Math.min(view.cursor - Math.floor(count / 2), tasks.length - count));
  return tasks.slice(start, start + count).flatMap((task, offset) => {
    const selected = start + offset === view.cursor;
    const title = `${selected ? '▶' : ' '} [${task.completed ? 'x' : ' '}] ${task.title}`;
    const meta = `${selected ? '│' : ' '}     ${taskMetadata(task, !view.listIndex)}`;
    return [ellipsize(title, width), ellipsize(meta, width), ...(rowHeight === 3 ? [''] : [])];
  }).slice(0, height);
}

function detailRows(task, width) {
  if (!task) return ['Task no longer matches these filters.'];
  return [...wrap(task.title, width),
    `${task.completed ? 'Completed' : 'Pending'} · ${dueLabel(task)}`,
    ...wrap(`List: ${safeText(task.list)}`, width), '', 'Description',
    ...wrap(task.editValues?.description || task.description || '(No description)', width),
    '', `Subtasks (${task.subtasks.length})`,
    ...task.subtasks.flatMap(item => wrap(`[${item.completed ? 'x' : ' '}] ${item.title} · ${dueLabel(item)}`, width)),
    '', ...wrap(`ID: ${task.id}`, width)].map(row => clip(row, width));
}

module.exports = { dueLabel, taskMetadata, taskSummary, taskRows, detailRows };
