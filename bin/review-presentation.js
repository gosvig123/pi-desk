'use strict';

// Rows and details for the Review list. Plain sanitized text only; colors come
// from task-styles.js.

const { clip, ellipsize, wrap, displayWidth } = require('./task-layout');
const { relativeTime, formatFire, humanizeSeconds } = require('./tick-schedule');
const { safeText } = require('./tasks-data');

function kindLabel(entry) {
  return entry.kind === 'tick' ? 'tick' : 'chat';
}

function outcomeLabel(entry) {
  if (entry.kind !== 'tick') return entry.outcome;
  return entry.outcome === 'ok' ? 'ok' : `failed${entry.reason && entry.reason !== 'exit_code' ? ` (${entry.reason})` : ''}`;
}

function reviewSummary(view) {
  const entries = view.visible();
  const chats = entries.filter(entry => entry.kind === 'conversation').length;
  const position = entries.length ? `${Math.min(view.cursor + 1, entries.length)}/${entries.length}` : '0/0';
  return [position, `${chats} chat${chats === 1 ? '' : 's'}`,
    `${entries.length - chats} tick${entries.length - chats === 1 ? '' : 's'}`].join(' · ');
}

function reviewRow(entry, width, now, selected) {
  let line = `${selected ? '▶' : ' '} ${kindLabel(entry)} ${entry.title}`;
  const parts = [outcomeLabel(entry), relativeTime(entry.completedAt, now) || 'unknown time'];
  for (const part of parts) {
    if (displayWidth(`${line} · ${part}`) > width) break;
    line += ` · ${part}`;
  }
  return ellipsize(line, width);
}

function reviewRows(view, height, width) {
  const entries = view.visible();
  const now = new Date();
  if (!entries.length) {
    return ['Nothing to review.', 'Completed replies and tick runs leave this list when acknowledged.']
      .slice(0, Math.max(0, height)).map(row => clip(row, width));
  }
  view.cursor = Math.min(view.cursor, entries.length - 1);
  const start = Math.max(0, Math.min(view.cursor - Math.floor(height / 2), entries.length - height));
  return entries.slice(start, start + height)
    .map((entry, offset) => reviewRow(entry, width, now, start + offset === view.cursor));
}

function outputSection(entry, width, heading = 'Output') {
  if (!entry.text) {
    const empty = entry.kind === 'tick'
      ? 'No readable output in this transcript.'
      : 'No assistant text near the end of this session file — open the conversation to read it.';
    return [empty, ''];
  }
  return [heading, ...wrap(entry.text, width), ''];
}

function conversationDetails(entry, width, now) {
  return [entry.title, `Reply ${formatFire(entry.completedAt)} · ${relativeTime(entry.completedAt, now)}`,
    ...wrap(`cwd: ${entry.context || '(unknown)'}`, width),
    ...wrap(`Session: ${safeText(entry.session?.file)}`, width), '',
    ...outputSection(entry, width, 'Last reply'),
    'Esc back · a reviewed all · Enter resumes from the list'].map(row => clip(row, width));
}

function tickDetails(entry, width, now) {
  const seconds = humanizeSeconds(Math.max(0,
    Math.round((Date.parse(entry.completedAt) - Date.parse(entry.startedAt)) / 1000)) || 0);
  const tokens = entry.tokens ? `${entry.tokens.input ?? 0} in · ${entry.tokens.output ?? 0} out` : '';
  return [`tick ${entry.title}`, `run ${entry.runId} · ${outcomeLabel(entry)} · ${seconds}`,
    `${formatFire(entry.completedAt)} · ${relativeTime(entry.completedAt, now)}${tokens ? ` · ${tokens}` : ''}`,
    ...wrap(`Transcript: ${entry.transcriptPath || '(none)'}`, width), '',
    ...(entry.error ? [...wrap(`Error: ${entry.error}`, width), ''] : []),
    ...outputSection(entry, width),
    'Esc back · a reviewed all'].map(row => clip(row, width));
}

function reviewDetailRows(entry, width, now = new Date()) {
  if (!entry) return ['This entry is no longer in the list.'];
  return entry.kind === 'tick' ? tickDetails(entry, width, now) : conversationDetails(entry, width, now);
}

module.exports = { kindLabel, outcomeLabel, reviewSummary, reviewRow, reviewRows, reviewDetailRows };