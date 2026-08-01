const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { buildResumeArgs, healOrphanedToolCalls } = require('../bin/pisesh');
const PISESH = path.resolve(__dirname, '../bin/pisesh');

function entry(id, parentId, message) {
  return { type: 'message', id, parentId, timestamp: '2026-07-20T00:00:00.000Z', message };
}

function assistant(id, stopReason, callId) {
  return entry(id, 'root', {
    role: 'assistant',
    content: [{ type: 'toolCall', id: callId, name: 'bash', arguments: {} }],
    stopReason,
  });
}

function writeSession(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisesh-test-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, `${entries.map(value => JSON.stringify(value)).join('\n')}\n`);
  return file;
}

function readSession(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  } catch (error) {
    assert.fail(`invalid session fixture: ${error.message}`);
  }
}

test('resumes with the current default model and thinking level', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisesh-settings-'));
  const settingsFile = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-5.6-sol',
    defaultThinkingLevel: 'medium',
  }));

  assert.deepEqual(buildResumeArgs({ id: 'session-id', file: '/sessions/session.jsonl' }, true, settingsFile), [
    '--session', 'session-id', '--session-dir', '/sessions',
    '--model', 'openai-codex/gpt-5.6-sol', '--thinking', 'medium',
  ]);
});

test('can resume with the model and thinking recorded in the session', () => {
  assert.deepEqual(buildResumeArgs({ id: 'session-id', file: '/sessions/session.jsonl' }, false), [
    '--session', 'session-id', '--session-dir', '/sessions',
  ]);
});

test('falls back to native session restore when settings are unavailable', () => {
  assert.deepEqual(buildResumeArgs({ id: 'session-id', file: '/sessions/session.jsonl' }, true, '/missing/settings.json'), [
    '--session', 'session-id', '--session-dir', '/sessions',
  ]);
});

test('supports custom agent and flat session directories, version, and stale cleanup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisesh-paths-'));
  const agentDir = path.join(root, 'agent');
  const sessionDir = path.join(root, 'sessions');
  fs.mkdirSync(agentDir);
  fs.mkdirSync(sessionDir);
  fs.writeFileSync(path.join(agentDir, 'favorites.json'), JSON.stringify({ ids: ['keep-id', 'stale-id'] }));
  fs.writeFileSync(path.join(sessionDir, 'session.jsonl'), `${JSON.stringify({
    type: 'session', id: 'keep-id', timestamp: '2026-08-01T00:00:00.000Z', cwd: root,
  })}\n`);

  const env = { ...process.env, PI_AGENT_DIR: agentDir, PI_SESSION_DIR: sessionDir };
  const cleaned = spawnSync(process.execPath, [PISESH, '--clean-favorites'], { env, encoding: 'utf8' });
  assert.equal(cleaned.status, 0, cleaned.stderr);
  assert.match(cleaned.stdout, /removed 1 stale favorite/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agentDir, 'favorites.json'))).ids, ['keep-id']);

  const version = spawnSync(process.execPath, [PISESH, '--version'], { env, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

for (const stopReason of ['error', 'aborted']) {
  test(`does not heal an ${stopReason} assistant tool call`, () => {
    const file = writeSession([
      assistant('assistant', stopReason, 'call-bad'),
      entry('user', 'assistant', { role: 'user', content: [{ type: 'text', text: 'continue' }] }),
    ]);

    assert.equal(healOrphanedToolCalls(file), 0);
    assert.deepEqual(readSession(file).map(value => value.message.role), ['assistant', 'user']);
  });
}

test('removes a previously injected result for an errored tool call', () => {
  const interrupted = entry('synthetic', 'assistant', {
    role: 'toolResult',
    toolCallId: 'call-bad',
    toolName: 'bash',
    content: [{ type: 'text', text: '[tool call interrupted: no result was recorded]' }],
    isError: true,
  });
  const file = writeSession([
    assistant('assistant', 'error', 'call-bad'),
    interrupted,
    entry('user', 'synthetic', { role: 'user', content: [{ type: 'text', text: 'continue' }] }),
  ]);

  assert.equal(healOrphanedToolCalls(file), 1);
  const healed = readSession(file);
  assert.deepEqual(healed.map(value => value.id), ['assistant', 'user']);
  assert.equal(healed[1].parentId, 'assistant');
  assert.equal(healOrphanedToolCalls(file), 0);
});

test('reports a session repair failure', () => {
  assert.throws(() => healOrphanedToolCalls('/missing/session.jsonl'), /session repair failed/);
});

test('still adds a result for a valid unfinished toolUse turn', () => {
  const file = writeSession([
    assistant('assistant', 'toolUse', 'call-good'),
    entry('user', 'assistant', { role: 'user', content: [{ type: 'text', text: 'continue' }] }),
  ]);

  assert.equal(healOrphanedToolCalls(file), 1);
  const healed = readSession(file);
  assert.deepEqual(healed.map(value => value.message.role), ['assistant', 'toolResult', 'user']);
  assert.equal(healed[1].message.toolCallId, 'call-good');
  assert.equal(healed[2].parentId, healed[1].id);
  assert.equal(healOrphanedToolCalls(file), 0);
});
