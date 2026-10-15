'use strict';

// Find earlier Pi conversations by topic. One summary per top-level session
// file (subagent runs and forks are left out) is cached in
// `$PI_AGENT_DIR/pisesh-search-index.json`; a search re-reads only files whose
// size or mtime changed. Session files stay read-only.
const fs = require('node:fs');
const path = require('node:path');
const { agentDir, sessionsRoot, readMeta } = require('./session-meta.js');

const INDEX_NAME = 'pisesh-search-index.json';
const INDEX_VERSION = 1;
const USER_TEXT_MAX = 6000;
const ANSWER_MAX = 800;
const LIST_MAX = 25;
const CHUNK = 1 << 20;

function indexFile(env = process.env) {
  return path.join(agentDir(env), INDEX_NAME);
}

// Complete lines of a file, read in chunks so large sessions are not loaded at once.
function* fileLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK);
    let rest = '';
    let read;
    while ((read = fs.readSync(fd, buffer, 0, CHUNK, null)) > 0) {
      const parts = (rest + buffer.toString('utf8', 0, read)).split('\n');
      rest = parts.pop();
      yield* parts;
    }
    if (rest) yield rest;
  } finally { fs.closeSync(fd); }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && c.type === 'text' && c.text).map(c => c.text).join('\n');
}

// Skill bodies and injected context blocks are not what the user asked.
function userWords(text) {
  return text.replace(/<skill name="([^"]+)"[\s\S]*?<\/skill>/g, '[skill $1]').trim();
}

function addUnique(list, value) {
  if (value && list.length < LIST_MAX && !list.includes(value)) list.push(value);
}

function summarize(file) {
  const summary = { id: '', cwd: '', started: '', userText: '', lastAnswer: '', files: [], urls: [] };
  for (const line of fileLines(file)) {
    // Tool results hold most of the bytes and none of the topic; skip them unparsed.
    if (!line || line.includes('"role":"toolResult"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'session') {
      summary.id = entry.id || '';
      summary.cwd = entry.cwd || '';
      summary.started = entry.timestamp || '';
      continue;
    }
    const message = entry.type === 'message' && entry.message;
    if (!message) continue;
    if (message.role === 'user') {
      const text = userWords(textOf(message.content));
      if (text && summary.userText.length < USER_TEXT_MAX) {
        summary.userText = (summary.userText + '\n' + text).slice(0, USER_TEXT_MAX);
      }
      for (const url of text.match(/https?:\/\/[^\s)>"'\]]+/g) || []) addUnique(summary.urls, url);
    } else if (message.role === 'assistant') {
      const text = textOf(message.content).trim();
      if (text) summary.lastAnswer = text.slice(-ANSWER_MAX);
      for (const url of text.match(/https?:\/\/[^\s)>"'`\]]+/g) || []) addUnique(summary.urls, url);
      for (const part of message.content || []) {
        if (part && part.type === 'toolCall' && (part.name === 'write' || part.name === 'edit')) {
          addUnique(summary.files, part.arguments && part.arguments.path);
        }
      }
    }
  }
  return summary.id ? summary : null;
}

function sessionFiles(root) {
  const files = [];
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return files; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(root, dir.name);
    let names;
    try { names = fs.readdirSync(full); } catch { continue; }
    for (const name of names) if (name.endsWith('.jsonl')) files.push(path.join(full, name));
  }
  return files;
}

function readIndex(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && data.version === INDEX_VERSION && data.sessions) return data.sessions;
  } catch { /* missing or old index: rebuild */ }
  return {};
}

// Refresh the cached summaries and return them with their file stats.
function loadSessions(env = process.env) {
  const cacheFile = indexFile(env);
  const cached = readIndex(cacheFile);
  const sessions = {};
  let changed = false;
  for (const file of sessionFiles(sessionsRoot(env))) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    const previous = cached[file];
    if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
      sessions[file] = previous;
      continue;
    }
    let summary = null;
    try { summary = summarize(file); } catch { /* unreadable file: skip */ }
    changed = true;
    if (summary) sessions[file] = { ...summary, size: stat.size, mtimeMs: stat.mtimeMs };
  }
  if (changed || Object.keys(cached).length !== Object.keys(sessions).length) {
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: INDEX_VERSION, sessions }));
      fs.renameSync(temporary, cacheFile);
    } catch { try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ } }
  }
  return sessions;
}

function terms(query) {
  return [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._@/-]*/gu) || [])]
    .filter(term => term.length > 1);
}

// "7d", "3w", or an ISO date.
function sinceTime(since, now = Date.now()) {
  if (!since) return 0;
  const relative = /^(\d+)\s*([dw])$/i.exec(String(since).trim());
  if (relative) return now - Number(relative[1]) * (relative[2].toLowerCase() === 'w' ? 7 : 1) * 86400000;
  const time = Date.parse(since);
  if (Number.isNaN(time)) throw new Error(`since "${since}" is not a date; use YYYY-MM-DD or a span like 7d or 2w`);
  return time;
}

function snippet(text, term, width = 220) {
  const at = text.toLowerCase().indexOf(term);
  if (at < 0) return text.slice(0, width).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start > 0 ? '…' : '') + text.slice(start, start + width).replace(/\s+/g, ' ').trim() + '…';
}

// Rank sessions: most query terms matched first, then weighted hits, then recency.
function searchSessions({ query, cwd, since, limit = 8, excludeId = '' } = {}, env = process.env) {
  const wanted = terms(query);
  if (!wanted.length) throw new Error('query needs at least one word of two or more letters');
  const after = sinceTime(since);
  const titles = readMeta().overrides;
  const results = [];
  for (const [file, session] of Object.entries(loadSessions(env))) {
    if (session.id === excludeId || (after && session.mtimeMs < after)) continue;
    if (cwd && !session.cwd.toLowerCase().includes(String(cwd).toLowerCase())) continue;
    const title = ((titles[session.id] || {}).title || '').trim();
    const fields = [
      [title.toLowerCase(), 5],
      [session.userText.toLowerCase(), 2],
      [session.files.join('\n').toLowerCase(), 2],
      [session.urls.join('\n').toLowerCase(), 2],
      [session.lastAnswer.toLowerCase(), 1],
      [session.cwd.toLowerCase(), 1],
    ];
    let matched = 0;
    let score = 0;
    let firstTerm = '';
    for (const term of wanted) {
      let hit = false;
      for (const [text, weight] of fields) {
        if (text.includes(term)) { score += weight; hit = true; }
      }
      if (hit) { matched += 1; if (!firstTerm) firstTerm = term; }
    }
    if (!matched) continue;
    results.push({ file, session, title, matched, score, firstTerm });
  }
  results.sort((a, b) => b.matched - a.matched || b.score - a.score || b.session.mtimeMs - a.session.mtimeMs);
  // Forks and resumed copies repeat the same conversation; keep the newest copy.
  const seen = new Set();
  const unique = results
    .slice()
    .sort((a, b) => b.session.mtimeMs - a.session.mtimeMs)
    .filter(({ session }) => {
      const key = session.cwd + '\n' + session.userText.slice(0, 300);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const kept = new Set(unique);
  const ranked = results.filter(result => kept.has(result));
  return {
    terms: wanted,
    total: ranked.length,
    results: ranked.slice(0, Math.max(1, Math.min(limit, 30))).map(({ file, session, title, matched, firstTerm }) => ({
      title: title || snippet(session.userText, '', 90),
      updated: new Date(session.mtimeMs).toISOString().slice(0, 16).replace('T', ' '),
      cwd: session.cwd,
      id: session.id,
      file,
      matched: `${matched}/${wanted.length}`,
      excerpt: snippet(session.userText.toLowerCase().includes(firstTerm) ? session.userText : session.lastAnswer || session.userText, firstTerm),
      lastAnswer: session.lastAnswer.slice(-300).replace(/\s+/g, ' ').trim(),
      files: session.files.slice(0, 6),
      urls: session.urls.slice(0, 4),
    })),
  };
}

module.exports = { INDEX_NAME, indexFile, summarize, loadSessions, searchSessions, sinceTime, terms };
