'use strict';

// Desk session metadata: `$PI_AGENT_DIR/pisesh-meta.json`.
//   { settings: { titleModel?, titleThinkingLevel? },
//     overrides: { "<sessionId>": { title?, titleSource?, cwd?, snooze?, ... } },
//     updated }
// Session jsonl files stay read-only history; Desk keeps its view of a session
// (display title, resume cwd, snooze) here, keyed by session id.
//
// Two writers share the file: the picker and the session-titles extension in
// every running pi. Each write re-reads the file, replaces only what it owns,
// and renames a per-process temporary file over it, so one writer does not
// erase another writer's sessions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const META_NAME = 'pisesh-meta.json';

function agentDir(env = process.env) {
  return path.resolve(env.PI_AGENT_DIR || env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent'));
}

function sessionsRoot(env = process.env) {
  return path.resolve(env.PI_SESSION_DIR || env.PI_CODING_AGENT_SESSION_DIR || path.join(agentDir(env), 'sessions'));
}

function metaFile(env = process.env) {
  return path.join(agentDir(env), META_NAME);
}

function readMeta(file = metaFile()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      overrides: (data && typeof data.overrides === 'object' && data.overrides) || {},
      settings: (data && typeof data.settings === 'object' && data.settings) || {},
    };
  } catch { return { overrides: {}, settings: {} }; }
}

// Read the file, let `change` edit it in place, then write it back atomically.
// Returns the merged state that was written.
function updateMeta(change, file = metaFile()) {
  const data = readMeta(file);
  change(data);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ ...data, updated: new Date().toISOString() }, null, 2));
    fs.renameSync(temporary, file);
  } catch (e) {
    try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
    throw new Error(`save meta failed: ${e.message}; check that ${path.dirname(file)} is writable`);
  }
  return data;
}

module.exports = { META_NAME, agentDir, sessionsRoot, metaFile, readMeta, updateMeta };
