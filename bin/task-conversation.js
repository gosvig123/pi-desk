'use strict';

// Task-conversation launch contract, shared by the picker and the /desk
// extension.
//
// Extension path: `startTaskConversation` waits for idle, opens a replacement
// session with `ctx.newSession()`, and passes the task through the environment.
// The replacement session's own extension instance calls
// `recordPendingTaskLink` to persist the link for its session id.
//
// Standalone path: the picker returns `buildNewConversation(task)` on its result
// fd, or spawns pi with `taskConversationEnv(task)`.
const { PENDING_TASK_ENV, takePendingTaskLink, writeTaskLink } = require('./task-links');

function taskLink(task) {
  return { id: task.id, title: task.title || '', list: task.list || '' };
}

function buildNewConversation(task) {
  return { version: 1, newConversation: { task: taskLink(task) } };
}

function taskConversationEnv(task) {
  return { [PENDING_TASK_ENV]: JSON.stringify(taskLink(task)) };
}

// Extension side. The guard keeps the same wait-for-idle contract as resume, and
// the environment value is cleared on every exit path.
async function startTaskConversation(task, ctx, guard) {
  if (!(await guard.wait(ctx))) return;
  process.env[PENDING_TASK_ENV] = JSON.stringify(taskLink(task));
  try {
    const created = await ctx.newSession();
    if (created.cancelled) ctx.ui.notify('New task conversation cancelled', 'info');
  } finally {
    guard.finish();
    delete process.env[PENDING_TASK_ENV];
  }
}

// Replacement-session side: record the link, name the session after the task,
// and report a failed save instead of claiming success.
function recordPendingTaskLink(ctx, hooks) {
  const task = takePendingTaskLink();
  if (!task) return;
  if (task.title) hooks.setName(task.title);
  try {
    writeTaskLink(ctx.sessionManager.getSessionId(), task);
    hooks.notify(`Conversation linked to task: ${task.title || task.id}`, 'info');
  } catch (error) {
    hooks.notify(`pi-desk: task link not saved: ${error.message}`, 'error');
  }
}

module.exports = { taskLink, buildNewConversation, taskConversationEnv, startTaskConversation, recordPendingTaskLink };
