'use strict';

// Row and detail text for the Ticks list. Mirrors task-presentation.js: build
// plain sanitized rows, clip to width, and let task-styles.js apply color.

const { clip, ellipsize, wrap, displayWidth } = require('./task-layout');
const { scheduleLabel, nextFireAt, formatFire, relativeTime, humanizeSeconds } = require('./tick-schedule');

function stateLabel(job) {
  if (job.running) return 'running';
  return job.enabled ? 'active' : 'disabled';
}

function runStatus(run) {
  if (run.exitCode === 0) return 'ok';
  return `exit ${run.exitCode ?? '?'}${run.reason && run.reason !== 'exit_code' ? ` (${run.reason})` : ''}`;
}

function lastRunLabel(job, now) {
  if (job.running) return 'running now';
  if (!job.lastRun) return 'never run';
  const when = relativeTime(job.lastRun.finishedAt, now) || 'unknown';
  return `${when} · ${runStatus(job.lastRun)}`;
}

function nextLabel(job, now) {
  const fire = nextFireAt(job.schedule, now);
  if (!job.enabled || !fire) return 'not scheduled';
  return `next ${formatFire(fire, false)}`;
}

function tickSummary(view) {
  const jobs = view.visible();
  const active = jobs.filter(job => job.enabled).length;
  const running = jobs.filter(job => job.running).length;
  const position = jobs.length ? `${Math.min(view.cursor + 1, jobs.length)}/${jobs.length}` : '0/0';
  return [position, `${active} active`, running ? `${running} running` : ''].filter(Boolean).join(' · ');
}

function tickRow(job, width, now, selected) {
  let line = `${selected ? '▶' : ' '} ${job.running ? '↻' : ' '} ${job.id}`;
  const parts = [stateLabel(job), scheduleLabel(job.schedule), nextLabel(job, now),
    `last ${lastRunLabel(job, now)}`];
  for (const part of parts) {
    if (displayWidth(`${line} · ${part}`) > width) break;
    line += ` · ${part}`;
  }
  return ellipsize(line, width);
}

function tickRows(view, height, width) {
  const jobs = view.visible();
  const now = new Date();
  if (!jobs.length) {
    if (view.loading) return [];
    return ['No tick jobs found.', 'Create one with: pi-tick add <id> --kind daily --time 09:00']
      .slice(0, Math.max(0, height)).map(row => clip(row, width));
  }
  view.cursor = Math.min(view.cursor, jobs.length - 1);
  const start = Math.max(0, Math.min(view.cursor - Math.floor(height / 2), jobs.length - height));
  return jobs.slice(start, start + height)
    .map((job, offset) => tickRow(job, width, now, start + offset === view.cursor));
}

function lastRunSection(run, width) {
  if (!run) return ['Last run: never', ''];
  const seconds = humanizeSeconds(Math.max(0,
    Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)) || 0);
  const rows = [`Last run ${formatFire(run.finishedAt)} · ${runStatus(run)} · ${seconds}`,
    ...wrap(`Transcript: ${run.transcriptPath || '(none)'}`, width), ''];
  if (run.preview) rows.push('Last output', ...wrap(run.preview, width), '');
  return rows;
}

function tickDetailRows(job, width, now = new Date()) {
  if (!job) return ['Job no longer exists.'];
  const fire = nextFireAt(job.schedule, now);
  return [job.id,
    `${stateLabel(job)} · ${scheduleLabel(job.schedule)} · ${job.enabled && fire ? `next ${formatFire(fire)}` : 'not scheduled'}`,
    ...wrap(`cwd: ${job.cwd || '(unset)'}`, width), `model: ${job.model || 'default'}`, '',
    ...lastRunSection(job.lastRun, width),
    'Prompt', ...wrap(job.prompt || '(empty)', width)].map(row => clip(row, width));
}

module.exports = { stateLabel, runStatus, lastRunLabel, tickSummary, tickRow, tickRows, tickDetailRows };
