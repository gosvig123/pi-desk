'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionSwitchGuard } = require('../bin/session-switch');

function setup(idle = false) {
  const handlers = new Map();
  const notices = [];
  let settle;
  const finished = new Promise(resolve => { settle = resolve; });
  const state = { idle, aborts: 0, waits: 0 };
  const ctx = {
    isIdle: () => state.idle,
    waitForIdle: () => { state.waits++; return state.idle ? Promise.resolve() : finished; },
    abort: () => { state.aborts++; },
    ui: { notify: message => notices.push(message) },
  };
  const guard = new SessionSwitchGuard({ on: (event, handler) => handlers.set(event, handler) });
  return { guard, ctx, state, notices, handlers, settle };
}

test('a running agent continues until it settles; Sesh never aborts it', async () => {
  const env = setup();
  let resolved = false;
  const waiting = env.guard.wait(env.ctx).then(result => { resolved = true; return result; });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(env.state.aborts, 0);
  assert.equal(env.guard.switching, false);
  assert.match(env.notices[0], /keep working/);
  env.state.idle = true;
  env.settle();
  assert.equal(await waiting, true);
  assert.equal(env.guard.switching, true);
  assert.equal(env.state.aborts, 0);
});

test('an idle session can switch immediately without a waiting notice', async () => {
  const env = setup(true);
  assert.equal(await env.guard.wait(env.ctx), true);
  assert.deepEqual(env.notices, []);
  assert.equal(env.state.aborts, 0);
  env.guard.finish();
  assert.equal(env.guard.switching, false);
});

test('a new run between settling and switching cancels the switch, not the run', async () => {
  const env = setup(true);
  await env.guard.wait(env.ctx);
  env.state.idle = false;
  const result = env.handlers.get('session_before_switch')({}, env.ctx);
  assert.deepEqual(result, { cancel: true });
  assert.equal(env.state.aborts, 0);
  assert.match(env.notices[0], /still working/);
});

test('a new run before the idle wait returns keeps the current session', async () => {
  const env = setup();
  const waiting = env.guard.wait(env.ctx);
  env.settle();
  assert.equal(await waiting, false);
  assert.equal(env.guard.switching, false);
  assert.match(env.notices[1], /Another run started/);
});

test('session replacement or reload cancels a stale queued switch', async () => {
  const env = setup();
  const waiting = env.guard.wait(env.ctx);
  env.handlers.get('session_shutdown')();
  env.state.idle = true;
  env.settle();
  assert.equal(await waiting, false);
  assert.equal(await env.guard.wait(env.ctx), false);
  assert.equal(env.guard.switching, false);
  assert.equal(env.state.waits, 1);
});

test('a newer selection replaces the previous queued switch', async () => {
  const env = setup();
  const first = env.guard.wait(env.ctx);
  const second = env.guard.wait(env.ctx);
  env.state.idle = true;
  env.settle();
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
});

test('the guard does not change unrelated session switches', () => {
  const env = setup();
  assert.equal(env.handlers.get('session_before_switch')({}, env.ctx), undefined);
  assert.equal(env.state.aborts, 0);
});

test('idle wait errors do not allow a switch or abort the agent', async () => {
  const env = setup();
  env.ctx.waitForIdle = async () => { throw new Error('runtime unavailable'); };
  await assert.rejects(env.guard.wait(env.ctx), /runtime unavailable/);
  assert.equal(env.guard.switching, false);
  assert.equal(env.state.aborts, 0);
});
