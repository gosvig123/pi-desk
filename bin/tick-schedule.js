'use strict';

const { safeText } = require('./tasks-data');
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function humanizeSeconds(total) {
  if (total < 60) return `${total}s`;
  if (total < 3600) return total % 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${Math.floor(total / 60)}m`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function scheduleLabel(schedule) {
  const value = schedule?.value ?? {};
  if (schedule?.kind === 'interval') {
    return `every ${humanizeSeconds((value.minutes ?? 0) * 60 + (value.seconds ?? 0))}`;
  }
  if (schedule?.kind === 'daily') return `daily @ ${safeText(value.time)}`;
  if (schedule?.kind === 'weekly') {
    return `weekly ${(value.days ?? []).map(safeText).join(', ')} @ ${safeText(value.time)}`;
  }
  return 'unscheduled';
}

function atTime(now, hhmm) {
  const [hour, minute] = String(hhmm ?? '').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function nextWeekly(now, days, hhmm) {
  let best = null;
  for (const day of days) {
    const target = DAY_NAMES.indexOf(safeText(day).toLowerCase());
    const candidate = target < 0 ? null : atTime(now, hhmm);
    if (!candidate) continue;
    candidate.setDate(candidate.getDate() + ((target - now.getDay() + 7) % 7));
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

function nextFireAt(schedule, now = new Date()) {
  const value = schedule?.value ?? {};
  if (schedule?.kind === 'interval') {
    return new Date(now.getTime() + ((value.minutes ?? 0) * 60 + (value.seconds ?? 0)) * 1000);
  }
  if (schedule?.kind === 'daily') {
    const next = atTime(now, value.time);
    if (!next) return null;
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  if (schedule?.kind === 'weekly') return nextWeekly(now, value.days ?? [], value.time);
  return null;
}

function formatFire(iso, withYear = true) {
  const date = iso instanceof Date ? iso : new Date(safeText(iso));
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  const day = `${withYear ? `${date.getFullYear()}-` : ''}${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function relativeTime(iso, now = new Date()) {
  const time = new Date(safeText(iso)).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
module.exports = { humanizeSeconds, scheduleLabel, nextFireAt, formatFire, relativeTime };
