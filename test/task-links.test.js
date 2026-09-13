'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { TASK_LINKS_NAME, PENDING_TASK_ENV, readTaskLinks, writeTaskLink, takePendingTaskLink } = require('../bin/task-links');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desk-links-'));
}

function tempFile() {
  return path.join(tempDir(), TASK_LINKS_NAME);
}

test('each write keeps the links of the other sessions', () => {
  const file = tempFile();
  writeTaskLink('session-a', { id: 'task-1', title: 'Ship it', list: 'work' }, file);
  writeTaskLink('session-b', { id: 'task-2', title: 'Fix it', list: 'today' }, file);
  assert.deepEqual(readTaskLinks(file), {
    'session-a': { id: 'task-1', title: 'Ship it', list: 'work' },
    'session-b': { id: 'task-2', title: 'Fix it', list: 'today' },
  });
});

test('the task id is the association and control characters never reach the file', () => {
  const file = tempFile();
  assert.deepEqual(writeTaskLink('session-a', { id: ' task-1 ', title: 'bad\u0007title' }, file),
    { id: 'task-1', title: 'bad title', list: '' });
  assert.deepEqual(readTaskLinks(file)['session-a'], { id: 'task-1', title: 'bad title', list: '' });
});

test('a write without a task id clears the link', () => {
  const file = tempFile();
  writeTaskLink('session-a', { id: 'task-1' }, file);
  assert.equal(writeTaskLink('session-a', null, file), null);
  assert.deepEqual(readTaskLinks(file), {});
  assert.equal(writeTaskLink('', { id: 'task-1' }, file), null);
});

test('a missing file reads as empty state', () => {
  assert.deepEqual(readTaskLinks(tempFile()), {});
});

test('a corrupt file blocks writes instead of erasing the links it holds', () => {
  const file = tempFile();
  fs.writeFileSync(file, '{ "links": oops');
  assert.throws(() => readTaskLinks(file), /not valid JSON/);
  assert.throws(() => writeTaskLink('session-a', { id: 'task-1' }, file), /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "links": oops');
});

test('an unwritable target fails loudly and keeps the previous links', () => {
  const dir = tempDir();
  const file = path.join(dir, TASK_LINKS_NAME);
  writeTaskLink('session-a', { id: 'task-1', title: 'Keep me' }, file);
  const before = fs.readFileSync(file, 'utf8');
  fs.chmodSync(dir, 0o500);
  try {
    assert.throws(() => writeTaskLink('session-b', { id: 'task-2' }, file), /could not (save|lock) task links/);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(readTaskLinks(file)['session-a'], { id: 'task-1', title: 'Keep me', list: '' });
  assert.equal(fs.existsSync(`${file}.lock`), false);
  assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
});

test('a write creates a nested storage directory that does not exist yet', () => {
  const file = path.join(tempDir(), 'nested', 'agent', TASK_LINKS_NAME);
  writeTaskLink('session-a', { id: 'task-1', title: 'Ship it' }, file);
  assert.deepEqual(readTaskLinks(file)['session-a'], { id: 'task-1', title: 'Ship it', list: '' });
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test('an old lock is never stolen and the error names the recovery step', { timeout: 20000 }, () => {
  const dir = tempDir();
  const file = path.join(dir, TASK_LINKS_NAME);
  writeTaskLink('session-a', { id: 'task-1', title: 'Keep me' }, file);
  const before = fs.readFileSync(file, 'utf8');
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, 'held by a paused owner');
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(lock, old, old);
  const staleMtime = fs.statSync(lock).mtimeMs;

  const started = Date.now();
  let failure;
  try { writeTaskLink('session-b', { id: 'task-2' }, file); } catch (error) { failure = error; }
  const waited = Date.now() - started;
  assert.ok(failure, 'a foreign lock must fail the write');
  assert.match(failure.message, /locked by another process/);
  assert.match(failure.message, /delete .*pisesh-task-links\.json\.lock if no pi-desk is running/);
  assert.ok(waited >= 1900, `expected the bounded wait, waited ${waited}ms`);
  assert.ok(waited < 8000, `expected a bounded wait, waited ${waited}ms`);
  assert.equal(fs.existsSync(lock), true, 'a foreign lock is left for its owner');
  assert.equal(fs.readFileSync(lock, 'utf8'), 'held by a paused owner');
  assert.equal(fs.statSync(lock).mtimeMs, staleMtime, 'the lock must not be touched');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(readTaskLinks(file)['session-b'], undefined);
  assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
});

test('a waiting writer proceeds after the owner releases, and never steals', { timeout: 20000 }, async () => {
  const dir = tempDir();
  const file = path.join(dir, TASK_LINKS_NAME);
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, 'live owner');
  const modulePath = path.join(__dirname, '..', 'bin', 'task-links.js');
  const script = `
    const { writeTaskLink } = require(process.env.LINK_MODULE);
    writeTaskLink('session-b', { id: 'task-2', title: 'Later' }, process.env.LINK_FILE);
  `;
  const started = Date.now();
  setTimeout(() => fs.unlinkSync(lock), 300);
  await new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', script], {
      env: { ...process.env, LINK_MODULE: modulePath, LINK_FILE: file },
      timeout: 15000,
    }, (error, stdout, stderr) => error ? reject(new Error(`${error.message} ${stderr}`)) : resolve(stdout));
  });
  assert.ok(Date.now() - started >= 250, 'the writer must wait for the owner');
  assert.deepEqual(readTaskLinks(file)['session-b'], { id: 'task-2', title: 'Later', list: '' });
  assert.equal(fs.existsSync(lock), false);
});

test('concurrent writers in separate processes keep every link', { timeout: 30000 }, async () => {
  const file = tempFile();
  const modulePath = path.join(__dirname, '..', 'bin', 'task-links.js');
  const script = `
    const { writeTaskLink } = require(process.env.LINK_MODULE);
    for (let index = 0; index < 8; index += 1) {
      writeTaskLink(\`\${process.env.LINK_ID}-\${index}\`, { id: \`task-\${index}\`, title: \`T\${index}\` }, process.env.LINK_FILE);
    }
  `;
  const writers = ['a', 'b', 'c'].map(id => new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', script], {
      env: { ...process.env, LINK_MODULE: modulePath, LINK_FILE: file, LINK_ID: id },
      timeout: 20000,
    }, (error, stdout, stderr) => error ? reject(new Error(`${error.message} ${stderr}`)) : resolve(stdout));
  }));
  await Promise.all(writers);

  const links = readTaskLinks(file);
  assert.equal(Object.keys(links).length, 24);
  for (const id of ['a', 'b', 'c']) {
    for (let index = 0; index < 8; index += 1) {
      assert.deepEqual(links[`${id}-${index}`], { id: `task-${index}`, title: `T${index}`, list: '' });
    }
  }
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test('the pending link is consumed once from the environment', () => {
  const env = { [PENDING_TASK_ENV]: JSON.stringify({ id: 'task-1', title: 'Ship it', list: 'work' }) };
  assert.deepEqual(takePendingTaskLink(env), { id: 'task-1', title: 'Ship it', list: 'work' });
  assert.equal(env[PENDING_TASK_ENV], undefined);
  assert.equal(takePendingTaskLink(env), null);
  assert.equal(takePendingTaskLink({ [PENDING_TASK_ENV]: 'oops' }), null);
  assert.equal(takePendingTaskLink({ [PENDING_TASK_ENV]: JSON.stringify({ title: 'no id' }) }), null);
});
