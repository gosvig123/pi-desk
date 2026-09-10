'use strict';
const { displayWidth, ellipsize, wrap } = require('./task-layout');
const { taskMetadata } = require('./task-presentation');
const { boardLanes, boardWindow, CARD_HEIGHT } = require('./task-board-model');
const RESET = '\x1b[0m';
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - displayWidth(text)));
const paint = (text, code, styled) => styled ? `\x1b[${code}m${text}${RESET}` : text;

function titleLines(text, width) {
  const rows = [''];
  for (const word of text.split(/\s+/)) {
    for (const part of wrap(word, width)) {
      const index = rows.length - 1;
      const next = rows[index] ? rows[index] + ' ' + part : part;
      if (displayWidth(next) > width) rows.push(part);
      else rows[index] = next;
    }
  }
  return rows;
}

function cardRows(item, cursor, width, showList, styled) {
  const selected = item.index === cursor;
  const task = item.task;
  const title = titleLines(task.title, Math.max(1, width - 10));
  const heading = `${selected ? '›' : ' '} [${task.completed ? 'x' : ' '}] ${title[0] || ''}`;
  const continuation = '      ' + ellipsize(title.slice(1).join(' '), Math.max(1, width - 10));
  const body = text => '│ ' + pad(ellipsize(text, width - 4), width - 4) + ' │';
  const border = (left, right) => paint(left + '─'.repeat(width - 2) + right, selected ? '36' : '2', styled);
  const metadata = body(taskMetadata(task, showList));
  return [border('╭', '╮'), paint(body(heading), selected ? '7;1' : task.completed ? '2' : '1', styled),
    paint(body(continuation), selected ? '7' : task.completed ? '2' : '0', styled),
    paint(metadata, !task.completed && taskMetadata(task, false).startsWith('Overdue') ? '33' : '2', styled),
    border('╰', '╯')];
}

function laneRows(lane, view, height, width, styled) {
  const count = Math.max(1, Math.floor((height - 2) / CARD_HEIGHT));
  const selected = lane.items.findIndex(item => item.index === view.cursor);
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), lane.items.length - count));
  const title = pad(ellipsize(`${lane.title} (${lane.items.length})`, width), width);
  const rows = [paint(title, selected >= 0 ? '1;36' : '1', styled)];
  rows.push(...lane.items.slice(start, start + count).flatMap(item => cardRows(item, view.cursor, width, !view.listIndex, styled)));
  if (!lane.items.length) rows.push(paint(pad('  No tasks', width), '2', styled));
  while (rows.length < height - 1) rows.push(' '.repeat(width));
  const end = Math.min(start + count, lane.items.length);
  const scroll = lane.items.length > count ? `${start + 1}–${end} of ${lane.items.length} · ↑↓ scroll` : '';
  rows.push(paint(pad(ellipsize(scroll, width), width), '2', styled));
  return rows.slice(0, height);
}

function boardRows(view, height, width, styled = false) {
  const lanes = boardLanes(view.visible());
  const window = boardWindow(lanes, view.cursor, width);
  const hidden = window.total > window.lanes.length;
  const laneHeight = height - (hidden ? 1 : 0);
  view.boardPageSize = Math.max(1, Math.floor((laneHeight - 2) / CARD_HEIGHT));
  const columns = window.lanes.map(lane => laneRows(lane, view, laneHeight, window.width, styled));
  const rows = Array.from({ length: laneHeight }, (_, index) => columns.map(column => column[index]).join('  '));
  if (hidden) rows.push(ellipsize(`Columns ${window.start + 1}–${window.start + window.lanes.length} of ${window.total} · ←→ more columns`, width));
  return rows;
}

module.exports = { boardRows };
