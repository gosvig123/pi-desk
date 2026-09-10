'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire, stripTypeScriptTypes } = require('node:module');
const { setImmediate: yieldTurn } = require('node:timers/promises');
const supported = typeof stripTypeScriptTypes === 'function';

function loadExtension() {
  const file = path.resolve(__dirname, '../extensions/sesh.ts');
  const source = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'))
    .replace(/^import (.+) from (.+);$/gm, 'const $1 = require($2);')
    .replace('export default function', 'module.exports = function');
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: createRequire(file), __dirname: path.dirname(file), process });
  return module.exports;
}

function commandHarness(selection, idle = false) {
  const events = new Map();
  let command;
  let settle;
  const finished = new Promise(resolve => { settle = resolve; });
  const state = { idle, switches: 0, aborts: 0, waits: 0, notices: [] };
  loadExtension()({ on: (name, handler) => events.set(name, handler),
    registerCommand: (name, options) => { assert.equal(name, 'desk'); command = options.handler; } });
  const ctx = { mode: 'tui', isIdle: () => state.idle,
    waitForIdle: () => { state.waits++; return state.idle ? Promise.resolve() : finished; },
    abort: () => { state.aborts++; },
    sessionManager: { getSessionId: () => 'current', getSessionFile: () => '/sessions/current.jsonl' },
    ui: { custom: async () => selection ? { code: 0, selection } : undefined,
      notify: message => state.notices.push(message) },
    switchSession: async () => { assert.equal(state.idle, true); state.switches++; return { cancelled: false }; } };
  return { state, ctx, events, settle, run: () => command('', ctx) };
}
const target = { version: 1, sessionPath: '/sessions/other.jsonl', resumeMode: 'session' };

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
  env.events.get('session_shutdown')();
  env.state.idle = true;
  env.settle();
  await running;
  assert.equal(env.state.switches, 0);
  assert.equal(env.state.aborts, 0);
});
