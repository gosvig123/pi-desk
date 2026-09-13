'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire, stripTypeScriptTypes } = require('node:module');
const { setImmediate: yieldTurn } = require('node:timers/promises');
const { PENDING_TASK_ENV, readTaskLinks } = require('../bin/task-links');
const supported = typeof stripTypeScriptTypes === 'function';

function loadExtension() {
  const file = path.resolve(__dirname, '../extensions/sesh.ts');
  const source = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'))
    .replace(/^import ([\s\S]+?) from ("[^"]+");$/gm, 'const $1 = require($2);')
    .replace('export default function', 'module.exports = function');
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: createRequire(file), __dirname: path.dirname(file), process });
  return module.exports;
}

// Each harness gets its own agent dir so the task-link file stays isolated.
function agentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desk-command-'));
}

function commandHarness(selection, idle = false, options = {}) {
  const events = new Map();
  const handlers = name => events.get(name) || [];
  const replay = new Map();
  let command;
  let settle;
  const finished = new Promise(resolve => { settle = resolve; });
  const state = { idle, switches: 0, newSessions: 0, aborts: 0, waits: 0, names: [], notices: [], replacement: false };
  let sessionId = 'current';
  const ui = { custom: async () => selection ? { code: 0, selection } : undefined,
    notify: message => state.notices.push(message) };
  const pi = { on: (name, handler) => events.set(name, [...handlers(name), handler]),
    registerCommand: (name, cmd) => { assert.equal(name, 'desk'); command = cmd.handler; },
    setSessionName: name => state.names.push(name),
    setModel: async () => true,
    setThinkingLevel: () => {} };
  loadExtension()(pi);
  const sessionManager = { getSessionId: () => sessionId, getSessionFile: () => '/sessions/current.jsonl' };
  const ctx = { mode: 'tui', isIdle: () => state.idle,
    waitForIdle: () => { state.waits++; return state.idle ? Promise.resolve() : finished; },
    abort: () => { state.aborts++; },
    sessionManager,
    ui,
    switchSession: async () => { assert.equal(state.idle, true); state.switches++; return { cancelled: false }; },
    newSession: async () => {
      state.newSessions++;
      if (options.cancelled) return { cancelled: true };
      sessionId = 'linked';
      await startReplacementInstance();
      return { cancelled: false };
    } };
  // Pi loads a fresh extension instance for the replacement session, so the
  // harness registers a second instance and replays session_start on it.
  async function startReplacementInstance() {
    const replacement = { on: (name, handler) => replay.set(name, [...(replay.get(name) || []), handler]),
      registerCommand: () => {},
      setSessionName: pi.setSessionName,
      setModel: pi.setModel,
      setThinkingLevel: pi.setThinkingLevel };
    loadExtension()(replacement);
    state.replacement = true;
    const replaced = { ...ctx, sessionManager: { ...sessionManager, getSessionId: () => sessionId } };
    for (const handler of replay.get('session_start') || []) await handler({ reason: 'new' }, replaced);
  }
  const emit = name => { for (const handler of handlers(name)) handler({}, ctx); };
  return { state, ctx, emit, settle, run: () => command('', ctx) };
}

const target = { version: 1, sessionPath: '/sessions/other.jsonl', resumeMode: 'session' };
const taskSelection = { version: 1, newConversation: { task: { id: 'task-1', title: 'Ship the desk link', list: 'work' } } };

test('the real /desk command waits before calling switchSession', { skip: !supported }, async () => {
  const env = commandHarness(target);
  const running = env.run();
  await yieldTurn();
  assert.equal(env.state.switches, 0);
  assert.equal(env.state.waits, 1);
  assert.equal(env.state.aborts, 0);
  env.state.idle = true;
  env.settle();
  await running;
  assert.equal(env.state.switches, 1);
  assert.equal(env.state.aborts, 0);
});

test('closing the picker or selecting the current session never waits or switches', { skip: !supported }, async () => {
  for (const selection of [undefined, { ...target, sessionPath: '/sessions/current.jsonl' }]) {
    const env = commandHarness(selection);
    await env.run();
    assert.equal(env.state.switches, 0);
    assert.equal(env.state.waits, 0);
    assert.equal(env.state.aborts, 0);
  }
});

test('the real /desk command drops a queued switch after shutdown', { skip: !supported }, async () => {
  const env = commandHarness(target);
  const running = env.run();
  await yieldTurn();
  env.emit('session_shutdown');
  env.state.idle = true;
  env.settle();
  await running;
  assert.equal(env.state.switches, 0);
  assert.equal(env.state.aborts, 0);
});

test('a task selection starts a linked conversation instead of switching sessions', { skip: !supported }, async () => {
  const previous = process.env.PI_AGENT_DIR;
  const dir = agentDir();
  process.env.PI_AGENT_DIR = dir;
  try {
    const env = commandHarness(taskSelection, true);
    await env.run();
    assert.equal(env.state.newSessions, 1);
    assert.equal(env.state.switches, 0);
    assert.equal(env.state.replacement, true, 'session_start must replay on a replacement instance');
    assert.deepEqual(env.state.names, ['Ship the desk link']);
    assert.match(env.state.notices.join(' '), /Ship the desk link/);
    assert.deepEqual(readTaskLinks(path.join(dir, 'pisesh-task-links.json')),
      { linked: { id: 'task-1', title: 'Ship the desk link', list: 'work' } });
    assert.equal(process.env[PENDING_TASK_ENV], undefined);
  } finally {
    if (previous === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = previous;
  }
});

test('a cancelled new session leaves no pending link behind', { skip: !supported }, async () => {
  const previous = process.env.PI_AGENT_DIR;
  const dir = agentDir();
  process.env.PI_AGENT_DIR = dir;
  try {
    const env = commandHarness(taskSelection, true, { cancelled: true });
    await env.run();
    assert.equal(env.state.newSessions, 1);
    assert.equal(env.state.switches, 0);
    assert.equal(process.env[PENDING_TASK_ENV], undefined);
    assert.deepEqual(readTaskLinks(path.join(dir, 'pisesh-task-links.json')), {});
  } finally {
    if (previous === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = previous;
  }
});
