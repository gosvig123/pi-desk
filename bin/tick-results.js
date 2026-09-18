'use strict';

// Read finished runs, not the job catalog. Each run remains visible after review.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('./tasks-data');
const { ellipsize, wrap } = require('./task-layout');
const AGENT_DIR = process.env.PI_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
const TICK_DIR = process.env.PI_TICK_DATA_DIR || path.join(AGENT_DIR, 'tick');
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

function remoteTickResults(reviewed, agentDir) {
  const read = name => {
    const file = path.join(agentDir, 'desk-sync', name + '.json');
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Tick snapshot exceeds limit');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  try {
    const config = read('config');
    const peer = read('peer');
    if (peer.version !== 1 || peer.origin !== config.peerOrigin || typeof peer.origin !== 'string' || !Array.isArray(peer.ticks) || peer.ticks.length > MAX_RUNS) return [];
    const origin = safeText(peer.origin);
    const stale = Math.min(peer.receivedAt || 0, peer.generatedAt || 0) * 1000 < Date.now() - 120000;
    return peer.ticks.filter(row => row && ['jobId', 'runId'].every(k => typeof row[k] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(row[k]))
      && Number.isFinite(Date.parse(row.finishedAt)) && ['ok', 'failed'].includes(row.outcome) && typeof row.text === 'string' && row.text.length <= 16000).map(row => {
      const key = `tick:${origin}:${row.jobId}:${row.runId}`;
      const text = safeLines(row.text);
      return { kind: 'tick', remote: true, origin, stale, key, id: row.jobId, runId: row.runId,
        completedAt: row.finishedAt, outcome: row.outcome, error: safeText(row.error),
        text, title: safeText(text || row.error || 'No output preview'), reviewed: reviewed.has(key) };
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Cannot read remote Tick results: ${safeText(error.message)} — check /desk sync`);
  }
}

function loadTickResults(reviewed, dir = TICK_DIR, agentDir = dir === TICK_DIR ? AGENT_DIR : path.dirname(dir)) {
  let lines;
  try { lines = tailLines(path.join(dir, 'runs.jsonl'), 8 * 1024 * 1024); }
  catch (error) {
    if (error.code === 'ENOENT') lines = [];
    else throw new Error(`Cannot read tick results: ${safeText(error.message)} — press r to retry`);
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
  return [...runs.values(), ...remoteTickResults(reviewed, agentDir)].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

function resultRow(entry, width) {
  return ellipsize(`${entry.reviewed ? 'reviewed' : 'new'} · ${entry.remote ? `[${entry.origin}${entry.stale ? ' · offline/stale' : ''}] ` : ''}${entry.title}${entry.outcome === 'failed' ? ' [failed]' : ''} · ${entry.id} · ${entry.completedAt}`, width);
}

function resultDetails(entry, width) {
  let text = entry.text;
  let source = entry.remote ? `Synced result from ${entry.origin} (up to 8,000 characters; preview if transcript unavailable)` : 'Saved output preview';
  if (!entry.remote && entry.transcriptPath) {
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
    entry.remote ? `Origin: ${entry.origin}${entry.stale ? ' · offline/stale' : ''} · read-only; review marks stay on this machine` : `Transcript: ${entry.transcriptPath || '(none)'}`, '', source,
    ...(text || 'No readable output was saved for this run.').split('\n')];
  return Number.isFinite(width) ? rows.flatMap(row => wrap(row, width)) : rows;
}

module.exports = { loadTickResults, resultRow, resultDetails };
