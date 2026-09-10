'use strict';

const { execFile } = require('node:child_process');
const SCHEMA_VERSION = 1;
const TASKS_TAB = 'Tasks';
const ALL_LISTS = 'All lists';
const ALL_STATUSES = Object.freeze({ label: 'All', completed: null });
const TASK_STATUSES = Object.freeze([
  ALL_STATUSES,
  Object.freeze({ label: 'Pending', completed: false }),
  Object.freeze({ label: 'Completed', completed: true }),
]);

function readTasksJson(args) {
  return new Promise((resolve, reject) => {
    execFile('tasks', ['api', ...args], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new Error(error.code === 'ENOENT'
        ? 'tasks CLI not found on PATH' : 'tasks CLI read failed (check tasks api lists)'));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('tasks CLI returned invalid JSON')); }
    });
  });
}

function checkResponse(value) {
  if (!value || value.error || value.success === false) throw new Error('tasks CLI reported an error; check tasks api lists / snapshot');
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported tasks CLI schema version');
  return value;
}

function safeText(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ') : '';
}

function normalizeTask(task, list, revision) {
  if (!task || typeof task.title !== 'string' || typeof task.completed !== 'boolean') {
    throw new Error('Invalid task data');
  }
  return { title: safeText(task.title), id: safeText(task.id), list,
    revision, editValues: { title: task.title, description: task.description || '' },
    completed: task.completed, dueDate: safeText(task.dueDate), description: safeText(task.description),
    subtasks: (task.subtasks || []).map(item => normalizeTask(item, list, revision)) };
}

async function loadTasks(read = readTasksJson) {
  const response = checkResponse(await read(['lists']));
  if (!Array.isArray(response.lists) || !response.lists.every(name => typeof name === 'string')) {
    throw new Error('Invalid tasks list data');
  }
  const lists = [...new Set(response.lists)];
  const tasks = [];
  const errors = [];
  const revisions = {};
  for (const list of lists) {
    try {
      const snapshot = checkResponse(await read(['snapshot', '--list', list]));
      if (!Array.isArray(snapshot.tasks)) throw new Error('Invalid task snapshot');
      revisions[list] = snapshot.revision;
      tasks.push(...snapshot.tasks.map(task => normalizeTask(task, list, snapshot.revision)));
    } catch (error) { errors.push(`${safeText(list)}: ${safeText(error.message)}`); }
  }
  const currentList = lists.includes(response.currentList) ? response.currentList : null;
  return { lists, tasks, errors, currentList, revisions };
}

function filterTasks(tasks, list, query, status = ALL_STATUSES) {
  const text = query.toLowerCase();
  return tasks.filter(task => (list === null || task.list === list)
    && (status.completed === null || task.completed === status.completed)
    && [task.title, task.description, task.id, task.list, ...task.subtasks.map(item => item.title)]
      .some(value => value.toLowerCase().includes(text))).sort(compareDueDates);
}

function compareDueDates(left, right) {
  return (left.dueDate || '9999-99-99').localeCompare(right.dueDate || '9999-99-99');
}

module.exports = { TASKS_TAB, ALL_LISTS, ALL_STATUSES, TASK_STATUSES, safeText, loadTasks, filterTasks, readTasksJson };
