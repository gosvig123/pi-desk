'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PENDING_TASK_ENV, readTaskLinks } = require('../bin/task-links');
const { buildNewConversation, taskConversationEnv, startTaskConversation, recordPendingTaskLink } = require('../bin/task-conversation');
const { parseSelection } = require('../bin/session-selection');

const task = { id: 'task-1', title: 'Ship it', list: 'work' };
const TASK_LINKS = 'pisesh-task-links.json';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desk-conversation-'));
}

// Runs `body` with isolated link storage and restores the previous environment.
async function withStorage(dir, body) {
  const previousAgent = process.env.PI_AGENT_DIR;
  const previousTask = process.env[PENDING_TASK_ENV];
  process.env.PI_AGENT_DIR = dir;
  try { await body(); }
  finally {
    if (previousAgent === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = previousAgent;
    if (previousTask === undefined) delete process.env[PENDING_TASK_ENV];
    else process.env[PENDING_TASK_ENV] = previousTask;
  }
}

test('a task conversation request carries the task id plus display fallbacks only', () => {
  const request = buildNewConversation({ id: 'task-1', title: 'Ship it', list: 'work', description: 'ignored' });
  assert.deepEqual(request, { version: 1, newConversation: { task } });
  assert.equal(buildNewConversation({ id: 'task-1' }).newConversation.task.title, '');
  assert.deepEqual(parseSelection(JSON.stringify(request)), request);
});

test('the standalone handoff passes the same link through the environment', () => {
  const env = taskConversationEnv({ id: 'task-1', title: 'Ship it', list: 'work', revision: 'r1' });
  assert.deepEqual(JSON.parse(env[PENDING_TASK_ENV]), task);
  assert.deepEqual(Object.keys(env), [PENDING_TASK_ENV]);
});

test('starting a task conversation waits for idle and clears the handoff', async () => {
  const dir = tempDir();
  await withStorage(dir, async () => {
    const state = { waits: 0, sessions: 0, notices: [], finished: false };
    const guard = {
      wait: async () => { state.waits += 1; return true; },
      finish: () => { state.finished = true; },
    };
    const ctx = {
      newSession: async () => { state.sessions += 1; return { cancelled: false }; },
      ui: { notify: (message, level) => state.notices.push([message, level]) },
    };
    await startTaskConversation(task, ctx, guard);
    assert.equal(state.waits, 1);
    assert.equal(state.sessions, 1);
    assert.equal(state.finished, true);
    assert.deepEqual(state.notices, []);
    assert.equal(process.env[PENDING_TASK_ENV], undefined);
  });
});

test('a refused or cancelled start never leaves a pending handoff', async () => {
  const dir = tempDir();
  await withStorage(dir, async () => {
    const refused = { wait: async () => false, finish: () => { throw new Error('the guard must not finish'); } };
    const never = { newSession: async () => { throw new Error('must not start a session'); }, ui: { notify: () => {} } };
    await startTaskConversation(task, never, refused);
    assert.equal(process.env[PENDING_TASK_ENV], undefined);

    const notices = [];
    const cancelled = {
      newSession: async () => ({ cancelled: true }),
      ui: { notify: (message, level) => notices.push([message, level]) },
    };
    await startTaskConversation(task, cancelled, { wait: async () => true, finish: () => {} });
    assert.deepEqual(notices, [['New task conversation cancelled', 'info']]);
    assert.equal(process.env[PENDING_TASK_ENV], undefined);
  });
});

test('recording a pending link writes it for the new session and names the session', async () => {
  const dir = tempDir();
  await withStorage(dir, async () => {
    process.env[PENDING_TASK_ENV] = JSON.stringify(task);
    const names = [];
    const notices = [];
    recordPendingTaskLink({ sessionManager: { getSessionId: () => 'session-1' } },
      { setName: name => names.push(name), notify: (message, level) => notices.push([message, level]) });
    assert.deepEqual(names, ['Ship it']);
    assert.deepEqual(notices, [['Conversation linked to task: Ship it', 'info']]);
    assert.deepEqual(readTaskLinks(path.join(dir, TASK_LINKS)), { 'session-1': task });
    assert.equal(process.env[PENDING_TASK_ENV], undefined);
  });
});

test('an unavailable link target reports an actionable error and never claims success', async () => {
  const blocked = tempDir();
  const notADirectory = path.join(blocked, 'not-a-directory');
  fs.writeFileSync(notADirectory, 'x');
  await withStorage(notADirectory, async () => {
    process.env[PENDING_TASK_ENV] = JSON.stringify(task);
    const notices = [];
    recordPendingTaskLink({ sessionManager: { getSessionId: () => 'session-1' } },
      { setName: () => {}, notify: (message, level) => notices.push([message, level]) });
    assert.equal(notices.length, 1);
    assert.equal(notices[0][1], 'error');
    assert.match(notices[0][0], /^pi-desk: task link not saved: /);
    assert.match(notices[0][0], /not-a-directory/);
    assert.equal(fs.existsSync(path.join(notADirectory, TASK_LINKS)), false);
  });
});

test('a session without a pending task stays untouched', async () => {
  const dir = tempDir();
  await withStorage(dir, async () => {
    const names = [];
    const notices = [];
    recordPendingTaskLink({ sessionManager: { getSessionId: () => 'session-1' } },
      { setName: name => names.push(name), notify: (message, level) => notices.push([message, level]) });
    assert.deepEqual(names, []);
    assert.deepEqual(notices, []);
    assert.deepEqual(readTaskLinks(path.join(dir, TASK_LINKS)), {});
  });
});
