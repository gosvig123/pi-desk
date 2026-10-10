'use strict';

// Continue one finished tick run as a normal Pi conversation.
//
// pi-tick runs `pi --mode json --no-session`, so the run transcript (Pi's JSON
// event stream) is the only record of the run. It starts with the same session
// header Pi writes to session files and holds every finished message in a
// `message_end` event. This module copies those messages into a Pi session file
// in the job's cwd session directory and records the transcript as its
// `parentSession`, the way `pi --fork` records its source. The session id comes
// from the run, so continuing the same run again reopens its conversation.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_VERSION = 3;
const MESSAGE_ROLES = new Set(['user', 'assistant', 'toolResult']);
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

// Same layout as Pi's getDefaultSessionDir.
function cwdSessionDir(sessionsRoot, cwd) {
  return path.join(sessionsRoot, `--${path.resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
}

function runSessionId(entry) {
  const hex = crypto.createHash('sha256').update(`tick:${entry.id}:${entry.runId}`).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

function readRun(transcriptPath) {
  const size = fs.statSync(transcriptPath).size;
  if (size > MAX_TRANSCRIPT_BYTES) throw new Error(`transcript is ${size} bytes; the limit is ${MAX_TRANSCRIPT_BYTES}`);
  let header = null;
  const messages = [];
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === 'session' && !header) header = event;
    else if (event?.type === 'message_end' && MESSAGE_ROLES.has(event.message?.role)) messages.push(event.message);
  }
  return { header, messages };
}

function sessionEntries(entry, transcriptPath, header, messages, id, now) {
  const timestamp = now.toISOString();
  const used = new Set();
  let parentId = null;
  const entries = [{ type: 'session', version: SESSION_VERSION, id, timestamp, cwd: header.cwd, parentSession: transcriptPath }];
  const append = fields => {
    let entryId;
    do entryId = crypto.randomUUID().slice(0, 8); while (used.has(entryId));
    used.add(entryId);
    entries.push({ type: fields.type, id: entryId, parentId, ...fields });
    parentId = entryId;
  };
  append({ type: 'session_info', timestamp, name: `Tick ${entry.id} · ${entry.completedAt.slice(0, 16).replace('T', ' ')}` });
  for (const message of messages) {
    const at = new Date(message.timestamp);
    append({ type: 'message', timestamp: Number.isFinite(at.getTime()) ? at.toISOString() : timestamp, message });
  }
  return entries;
}

// Returns { id, file, created }. Throws an Error whose message says why the run
// cannot be continued; the caller adds the operation and shows it.
function continueTickRun(entry, { sessionsRoot, flat = false, now = new Date() }) {
  if (entry.remote) throw new Error(`it ran on ${entry.origin}; open /desk there to continue it`);
  if (!entry.transcriptPath) throw new Error('the run saved no transcript');
  let run;
  try { run = readRun(entry.transcriptPath); }
  catch (error) {
    throw new Error(error.code === 'ENOENT' ? `transcript was removed: ${entry.transcriptPath}` : `cannot read transcript: ${error.message}`);
  }
  if (!run.header?.cwd) throw new Error('transcript has no session header with a cwd');
  if (!run.messages.length) throw new Error('transcript has no finished messages');

  const id = runSessionId(entry);
  const dir = flat ? sessionsRoot : cwdSessionDir(sessionsRoot, run.header.cwd);
  const file = path.join(dir, `${entry.completedAt.replace(/[:.]/g, '-')}_${id}.jsonl`);
  if (fs.existsSync(file)) return { id, file, created: false };

  const lines = sessionEntries(entry, entry.transcriptPath, run.header, run.messages, id, now).map(item => JSON.stringify(item));
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, lines.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  return { id, file, created: true };
}

module.exports = { continueTickRun, cwdSessionDir, runSessionId };
