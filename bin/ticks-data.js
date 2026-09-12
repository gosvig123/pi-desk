'use strict';

// Read-only view of the pi-tick schedule. The catalog is the extension's own
// jobs.json; liveness comes from the per-run records under active/. Nothing
// here writes: mutations go through the pi-tick CLI in tick-actions.js.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeText } = require('./tasks-data');

const MAX_JOBS = 200;
const MAX_ACTIVE_RECORDS = 64;
const MAX_PROMPT = 8000;
const TICK_DIR = process.env.PI_TICK_DATA_DIR || path.join(os.homedir(), '.pi', 'agent', 'tick');

function tickPaths(dir = TICK_DIR) {
  return { catalog: path.join(dir, 'jobs.json'), active: path.join(dir, 'active'),
    cli: path.join(dir, 'pi-tick.mjs') };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return null; }
}

async function runningJobIds(activeDir) {
  let names;
  try { names = await fs.readdir(activeDir); } catch { return new Set(); }
  const ids = new Set();
  for (const name of names.slice(0, MAX_ACTIVE_RECORDS)) {
    const record = await readJson(path.join(activeDir, name));
    if (processIsAlive(record?.pid)) ids.add(safeText(record.jobId));
  }
  return ids;
}

function readLastRun(run) {
  if (!run || typeof run !== 'object') return null;
  return { startedAt: safeText(run.startedAt), finishedAt: safeText(run.finishedAt),
    exitCode: Number.isInteger(run.exitCode) ? run.exitCode : null,
    reason: safeText(run.reason), error: safeText(run.error),
    transcriptPath: safeText(run.transcriptPath), preview: safeLines(run.finalTextPreview) };
}

// Multi-line text keeps its line breaks so the details view stays readable.
function safeLines(value) {
  return String(value ?? '').split('\n').map(safeText).join('\n');
}

function normalizeJob(job, running) {
  if (!job || typeof job.id !== 'string' || !job.id) return null;
  return { id: safeText(job.id), prompt: safeLines(job.prompt).slice(0, MAX_PROMPT),
    cwd: safeText(job.cwd), model: safeText(job.model), schedule: job.schedule ?? null,
    enabled: job.enabled === true, running, lastRun: readLastRun(job.lastRun) };
}

async function loadTicks(dir = TICK_DIR) {
  const paths = tickPaths(dir);
  let document;
  try { document = JSON.parse(await fs.readFile(paths.catalog, 'utf8')); }
  catch (error) {
    return { jobs: [], error: error?.code === 'ENOENT' ? '' : 'cannot read tick jobs.json' };
  }
  if (!Array.isArray(document?.jobs)) return { jobs: [], error: 'tick jobs.json has no jobs array' };
  const running = await runningJobIds(paths.active);
  const jobs = document.jobs.slice(0, MAX_JOBS)
    .map(job => normalizeJob(job, running.has(safeText(job?.id))))
    .filter(Boolean);
  return { jobs, error: '' };
}

module.exports = { TICK_DIR, tickPaths, processIsAlive, loadTicks };
