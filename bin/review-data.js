'use strict';

// Builds the Review list: conversations whose last message is an assistant
// reply, plus finished tick runs. One entry per completed unit of work, newest
// first. Everything here is a read; acknowledgements live in review-store.js.

const fs = require('node:fs');
const path = require('node:path');
const { safeText } = require('./tasks-data');
const { TICK_DIR } = require('./ticks-data');

const MAX_TAIL_BYTES = 32 * 1024;
const MAX_TRANSCRIPT_BYTES = 256 * 1024;
const MAX_SESSIONS = 200;
const MAX_RUNS = 100;
const MAX_ENTRIES = 300;
const MAX_TEXTS = 24;
const MAX_TEXT = 4000;
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
// A review inbox is about recent work: older completions are history, not a
// decision waiting for the person, so they stay out of the list.
const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const REVIEW_WINDOW_DAYS = REVIEW_WINDOW_MS / (24 * 60 * 60 * 1000);

function tailLines(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // A partial first line is not a record.
    return lines;
  } finally { fs.closeSync(fd); }
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return safeText(content);
  if (!Array.isArray(content)) return '';
  return safeText(content.filter(part => part?.type === 'text' && part.text)
    .map(part => part.text).join('\n'));
}

// One tail read answers both questions the list asks about a conversation:
// who spoke last, and what that last reply said.
function readSessionTail(file) {
  let lines;
  try { lines = tailLines(file, MAX_TAIL_BYTES); } catch { return null; }
  let last = null;
  let text = '';
  for (const line of lines.reverse()) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    if (value.type !== 'message' || !value.message) continue;
    last ??= { role: safeText(value.message.role), timestamp: safeText(value.timestamp) };
    if (!text && value.message.role === 'assistant') text = messageText(value.message).slice(0, MAX_TEXT);
    if (last && text) break;
  }
  return last ? { ...last, text } : null;
}

// Tick transcripts are pi event streams (`message_end`), where a resumed pi
// session file uses `message`. Accept both, newest text wins.
function readTranscriptTail(file, bytes = MAX_TRANSCRIPT_BYTES) {
  let lines;
  try { lines = tailLines(file, bytes); } catch { return ''; }
  for (const line of lines.reverse()) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    if (!['message', 'message_end'].includes(value.type) || value.message?.role !== 'assistant') continue;
    const text = messageText(value.message).slice(0, MAX_TEXT);
    if (text) return text;
  }
  return '';
}

function conversationEntries(sessions, { currentId, reviewed, now }) {
  const entries = [];
  const recent = [...sessions]
    .filter(session => now.getTime() - session.mtime.getTime() < REVIEW_WINDOW_MS)
    .sort((left, right) => right.mtime - left.mtime).slice(0, MAX_SESSIONS);
  for (const session of recent) {
    if (!session.id || session.id === currentId) continue;
    const tail = readSessionTail(session.file);
    if (!tail || tail.role !== 'assistant') continue;
    const key = `session:${session.id}:${tail.timestamp || new Date(session.mtime).toISOString()}`;
    if (reviewed.has(key)) continue;
    entries.push({ kind: 'conversation', key, id: session.id, title: session.title,
      context: session.effectiveCwd || session.cwd || '',
      completedAt: tail.timestamp || new Date(session.mtime).toISOString(),
      outcome: 'replied', text: tail.text, session });
  }
  return entries;
}

function readRuns(dir = TICK_DIR) {
  const file = path.join(dir, 'runs.jsonl');
  let text;
  try {
    if (fs.statSync(file).size > MAX_REGISTRY_BYTES) return [];
    text = fs.readFileSync(file, 'utf8');
  } catch { return []; }
  return text.split('\n').filter(Boolean).slice(-MAX_RUNS)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function tickEntries(runs, { reviewed, now }) {
  const entries = [];
  for (const run of [...runs].reverse()) {
    const id = safeText(run?.jobId);
    const runId = safeText(run?.runId);
    if (!id || !runId) continue;
    if (now.getTime() - Date.parse(run.finishedAt) >= REVIEW_WINDOW_MS) continue;
    const key = `tick:${id}:${runId}`;
    if (reviewed.has(key)) continue;
    entries.push({ kind: 'tick', key, id, runId, title: id, context: safeText(run.triggerKind),
      startedAt: safeText(run.startedAt), completedAt: safeText(run.finishedAt),
      outcome: run.exitCode === 0 ? 'ok' : 'failed',
      reason: safeText(run.reason), error: safeText(run.error),
      transcriptPath: safeText(run.transcriptPath), tokens: run.tokens ?? null, text: '' });
  }
  return entries;
}

function collectReview({ sessions = [], currentId = '', reviewed, dir = TICK_DIR, now = new Date() }) {
  const entries = [...conversationEntries(sessions, { currentId, reviewed, now }),
    ...tickEntries(readRuns(dir), { reviewed, now })];
  const fresh = entries.filter(entry => now.getTime() - Date.parse(entry.completedAt) < REVIEW_WINDOW_MS);
  fresh.sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  const shown = fresh.slice(0, MAX_ENTRIES);
  for (const entry of shown.slice(0, MAX_TEXTS)) {
    if (entry.kind === 'tick' && entry.transcriptPath) entry.text = readTranscriptTail(entry.transcriptPath);
  }
  return shown;
}

module.exports = { collectReview, readSessionTail, readTranscriptTail, readRuns, REVIEW_WINDOW_DAYS };
