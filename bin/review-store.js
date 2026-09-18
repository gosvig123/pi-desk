'use strict';

// Review acknowledgements: which completed conversation replies and tick runs
// the person has already looked at. One small sidecar file, newest keys only.
// pi-desk is the only writer; a lost write costs an acknowledgement, not data.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = 1;
const MAX_KEYS = 2000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function agentDir() {
  return process.env.PI_AGENT_DIR || process.env.PI_CODING_AGENT_DIR
    || path.join(os.homedir(), '.pi', 'agent');
}

function reviewFile(dir = agentDir()) {
  return path.join(dir, 'pisesh-review.json');
}

function readReviewed(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && data.reviewed && typeof data.reviewed === 'object' ? data.reviewed : {};
  } catch { return {}; }
}

class ReviewStore {
  constructor(file = reviewFile()) {
    this.file = file;
    this.reviewed = readReviewed(file);
    this.fresh = !fs.existsSync(file);
  }

  has(key) { return typeof this.reviewed[key] === 'string'; }

  mark(keys, now = new Date()) {
    const stamp = now.toISOString();
    const previous = this.reviewed;
    this.reviewed = { ...previous };
    for (const key of [].concat(keys)) if (key) this.reviewed[key] = stamp;
    try { this.save(now); }
    catch (error) { this.reviewed = previous; throw error; }
    this.fresh = false;
  }

  // Keep the newest keys and drop stale ones, then replace the file in place so
  // a crash mid-write cannot leave truncated JSON behind.
  save(now = new Date()) {
    const kept = Object.entries(this.reviewed)
      .filter(([, at]) => now.getTime() - Date.parse(at) < MAX_AGE_MS)
      .sort((left, right) => right[1].localeCompare(left[1]))
      .slice(0, MAX_KEYS);
    this.reviewed = Object.fromEntries(kept);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: VERSION, reviewed: this.reviewed }, null, 2));
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (error) { throw new Error(`review status not saved: ${error.message}`); }
  }
}

module.exports = { ReviewStore, reviewFile, agentDir };
