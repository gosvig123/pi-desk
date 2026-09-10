'use strict';

const { execFile } = require('node:child_process');
const { safeText } = require('./tasks-data');

function executeTaskRequest(request) {
  return new Promise((resolve, reject) => {
    const child = execFile('tasks', ['api', 'exec'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error('tasks api exec failed; reload to check the result before retrying'));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error('Invalid tasks api exec response; reload before retrying')); }
      });
    child.stdin.on('error', () => {}); // Process failure is reported by execFile's callback.
    child.stdin.end(JSON.stringify(request));
  });
}

async function mutateTask(operation, target, changes, execute = executeTaskRequest) {
  if (!target.revision) throw new Error('Missing task revision; reload tasks before saving');
  if (!target.list) throw new Error('Choose a task list before adding a task');
  if (operation !== 'task.create' && !target.id) throw new Error('Missing task ID; reload tasks');
  const request = { schemaVersion: 1, operation, list: target.list,
    expectedRevision: target.revision, changes };
  if (target.id) request.taskId = target.id;
  const response = await execute(request);
  if (response?.success !== true) {
    throw new Error(`${safeText(response?.error?.message) || 'Task save failed'}; reload before retrying`);
  }
  return response;
}

module.exports = { mutateTask, executeTaskRequest };
