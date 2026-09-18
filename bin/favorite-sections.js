'use strict';

const { clip } = require('./task-layout');

// An absent deadline means active; null means snoozed until manually restored.
function isSnoozed(session, now = Date.now()) {
  return session.snoozedUntil === null || Date.parse(session.snoozedUntil) > Number(now);
}

function snoozeDeadline(input, now = Date.now()) {
  if (!input.trim()) return null;
  const match = /^(\d+)\s*([mhdw])$/i.exec(input.trim());
  const minutes = match && Number(match[1]) * { m: 1, h: 60, d: 1440, w: 10080 }[match[2].toLowerCase()];
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600) {
    throw new Error('Use 30m, 2h, 1d, or 1w (up to 365 days), or leave blank for no timer');
  }
  return new Date(Number(now) + minutes * 60000).toISOString();
}

function favoriteSections(sessions, results, now = Date.now()) {
  return [
    { label: 'Favorites', items: sessions.filter(session => session.favored && !isSnoozed(session, now)) },
    { label: 'Snoozed', items: sessions.filter(session => isSnoozed(session, now)) },
    { label: 'Tick results', items: results },
  ];
}

// Each section keeps its own viewport. The cursor crosses section boundaries
// in the same order as the screen, skipping empty sections.
function sectionRows(sections, cursor, height, width, renderItem) {
  const rows = [];
  let offset = 0;
  for (const [index, section] of sections.entries()) {
    const size = Math.floor(height / sections.length) + (index < height % sections.length ? 1 : 0);
    const selected = cursor - offset;
    const active = selected >= 0 && selected < section.items.length;
    const position = active ? `${selected + 1}/` : '';
    const unread = section.label === 'Tick results' ? ` · ${section.items.filter(item => !item.reviewed).length} new` : '';
    if (size > 0) rows.push(clip(`${section.label} (${position}${section.items.length})${unread}`, width));
    const available = Math.max(0, size - 1);
    const start = active ? Math.max(0, Math.min(selected - Math.floor(available / 2), section.items.length - available)) : 0;
    const body = section.items.slice(start, start + available)
      .map((item, index) => renderItem(item, width, active && start + index === selected));
    if (!body.length && available) body.push('  (none)');
    while (body.length < available) body.push('');
    rows.push(...body);
    offset += section.items.length;
  }
  return rows;
}

module.exports = { isSnoozed, snoozeDeadline, favoriteSections, sectionRows };
