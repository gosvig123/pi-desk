'use strict';

// Read finished runs, not the job catalog. Each run remains visible after review.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('./tasks-data');
const { ellipsize, wrap } = require('./task-layout');
const TICK_DIR = process.env.PI_TICK_DATA_DIR || path.join(os.homedir(), '.pi', 'agent', 'tick');
const MAX_RUNS = 100;
const safeLines = value => String(value || '').split('\n').map(safeText).join('\n');

function tailLines(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    const length = fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, length).toString('utf8').split('\n');
    if (start) lines.shift();
    return lines;
  } finally { fs.closeSync(fd); }
}

function loadTickResults(reviewed, dir = TICK_DIR) {
  let lines;
  try { lines = tailLines(path.join(dir, 'runs.jsonl'), 8 * 1024 * 1024); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Cannot read tick results: ${safeText(error.message)} — press r to retry`);
  }
  const runs = new Map();
  for (const line of lines.reverse()) {
    let run;
    try { run = JSON.parse(line); } catch { continue; }
    const id = safeText(run?.jobId);
    const runId = safeText(run?.runId);
    if (!id || !runId || !Number.isFinite(Date.parse(run.finishedAt))) continue;
    const key = `tick:${id}:${runId}`;
    if (runs.has(key)) continue;
    runs.set(key, { kind: 'tick', key, id, runId, completedAt: run.finishedAt,
      outcome: run.exitCode === 0 ? 'ok' : 'failed', error: safeText(run.error),
      transcriptPath: safeText(run.transcriptPath), text: safeLines(run.finalTextPreview),
      title: safeText(run.finalTextPreview || run.error || 'No output preview'), reviewed: reviewed.has(key) });
    if (runs.size === MAX_RUNS) break;
  }
  return [...runs.values()].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

function resultRow(entry, width) {
  return ellipsize(`${entry.reviewed ? 'reviewed' : 'new'} · ${entry.title}${entry.outcome === 'failed' ? ' [failed]' : ''} · ${entry.id} · ${entry.completedAt}`, width);
}

function resultDetails(entry, width) {
  let text = entry.text;
  let source = 'Saved output preview';
  if (entry.transcriptPath) {
    try {
      for (const line of tailLines(entry.transcriptPath, 256 * 1024).reverse()) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (!['message', 'message_end'].includes(event?.type) || event.message?.role !== 'assistant') continue;
        const content = event.message.content;
        const reply = typeof content === 'string' ? content : Array.isArray(content)
          ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : '';
        if (!reply.trim()) continue;
        text = safeLines(reply).slice(0, 32000);
        source = reply.length > 32000 ? 'Last reply (first 32,000 characters)' : 'Last reply';
        break;
      }
    } catch { source = 'Saved output preview (transcript unavailable)'; }
  }
  const rows = [`${entry.id} · ${entry.outcome} · ${entry.reviewed ? 'reviewed' : 'new'}`,
    `Run: ${entry.runId} · ${entry.completedAt}`,
    ...(entry.error ? [`Error: ${entry.error}`] : []),
    `Transcript: ${entry.transcriptPath || '(none)'}`, '', source,
    ...(text || 'No readable output was saved for this run.').split('\n')];
  return Number.isFinite(width) ? rows.flatMap(row => wrap(row, width)) : rows;
}

module.exports = { loadTickResults, resultRow, resultDetails };
