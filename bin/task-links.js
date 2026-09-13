'use strict';

// Conversation → task links for pi-desk.
//
// `$PI_AGENT_DIR/pisesh-task-links.json` stores one link per Pi session id:
//   { links: { "<sessionId>": { id, title, list } }, updated }
// The task id is the association, and `title` / `list` are display fallbacks
// for when the tasks CLI is unavailable, so a task rename never breaks a link.
//
// Two writers share the file: the picker (existing conversations) and the /desk
// extension (a conversation created from a task). Each update takes a bounded
// lock, merges its own link, and replaces the file atomically, so a concurrent
// writer never loses a link and a reader never sees a partial file. A lock is
// never stolen from a paused or crashed owner: the contender reports the lock
// path so a person can recover it.
//
// Write failures throw. Callers must report them and keep their old state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('./tasks-data');

const TASK_LINKS_NAME = 'pisesh-task-links.json';
const PENDING_TASK_ENV = 'PISESH_TASK_LINK';
const NO_LINK = null;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 2000;

function taskLinksFile(env = process.env) {
  const dir = env.PI_AGENT_DIR || env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent');
  return path.join(path.resolve(dir), TASK_LINKS_NAME);
}

// Returns null when the value carries no usable task id, which also means
// "clear the link" for writeTaskLink().
function normalizeLink(task) {
  const id = safeText(task && task.id).trim();
  if (!id) return NO_LINK;
  return { id, title: safeText(task.title).trim(), list: safeText(task.list).trim() };
}

// A missing file is empty state. A file that exists but cannot be read or parsed
// is an error: overwriting it would erase links the user still owns.
function readLinksState(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`could not read task links: ${error.message} (${file})`);
  }
  try {
    const data = JSON.parse(raw);
    return data && typeof data.links === 'object' && data.links ? data.links : {};
  } catch {
    throw new Error(`task link file is not valid JSON; fix or remove it (${file})`);
  }
}

function readTaskLinks(file = taskLinksFile()) {
  const links = readLinksState(file);
  const valid = {};
  for (const [sessionId, link] of Object.entries(links)) {
    const normalized = normalizeLink(link);
    if (normalized) valid[sessionId] = normalized;
  }
  return valid;
}

// Atomic replacement: write a sibling temporary file, then rename it over the
// target. Same directory, so the rename is atomic and readers stay consistent.
// The parent directory is a precondition created by writeTaskLink().
function writeLinksFile(file, links) {
  const payload = JSON.stringify({ links, updated: new Date().toISOString() }, null, 2);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, payload);
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
    throw new Error(`could not save task links: ${error.message}; check that the directory is writable (${file})`);
  }
}

function writeTaskLink(sessionId, task, file = taskLinksFile()) {
  if (!sessionId) return NO_LINK;
  const link = normalizeLink(task);
  makeStorageDir(file);
  withLinkLock(`${file}.lock`, () => {
    const links = readTaskLinks(file);
    if (link) links[sessionId] = link;
    else delete links[sessionId];
    writeLinksFile(file, links);
  });
  return link;
}

function makeStorageDir(file) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (error) { throw new Error(`could not create the task link directory: ${error.message} (${dir})`); }
}

// Bounded lock around one read-modify-write. A lock is never stolen: an owner
// that pauses or dies keeps it, and the contender reports how to recover.
function withLinkLock(lockPath, update) {
  const handle = openLock(lockPath);
  try { return update(); }
  finally {
    try { fs.closeSync(handle); } catch { /* handle already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* lock already released */ }
  }
}

function openLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try { return fs.openSync(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw new Error(`could not lock task links: ${error.message} (${lockPath})`);
    }
    if (Date.now() >= deadline) throw new Error(lockBusyMessage(lockPath));
    sleep(LOCK_RETRY_MS);
  }
}

function lockBusyMessage(lockPath) {
  return `task links are locked by another process; wait for it to finish, or delete ${lockPath} if no pi-desk is running`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Consume the link request that pi-desk hands to the next Pi session. The
// environment entry is deleted so a later session in the same process cannot
// inherit it.
function takePendingTaskLink(env = process.env) {
  const raw = env[PENDING_TASK_ENV];
  if (!raw) return NO_LINK;
  delete env[PENDING_TASK_ENV];
  try { return normalizeLink(JSON.parse(raw)); }
  catch { return NO_LINK; }
}

module.exports = {
  TASK_LINKS_NAME,
  PENDING_TASK_ENV,
  taskLinksFile,
  readTaskLinks,
  writeTaskLink,
  takePendingTaskLink,
};
