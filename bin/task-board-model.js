'use strict';
const LANES = ['Overdue', 'Today', 'Upcoming', 'No date', 'Completed'];
const MIN_BOARD_WIDTH = 72;
const CARD_HEIGHT = 5;

function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function laneName(task, today) {
  if (task.completed) return 'Completed';
  if (!task.dueDate) return 'No date';
  if (task.dueDate < today) return 'Overdue';
  return task.dueDate === today ? 'Today' : 'Upcoming';
}

function boardLanes(tasks, today = localDay()) {
  return LANES.map(title => ({ title, items: tasks.map((task, index) => ({ task, index }))
    .filter(item => laneName(item.task, today) === title) }))
    .filter(lane => lane.title === 'Today' || lane.items.length);
}

function boardWindow(lanes, cursor, width) {
  const selected = Math.max(0, lanes.findIndex(lane => lane.items.some(item => item.index === cursor)));
  const count = Math.min(lanes.length, Math.max(1, Math.floor((width + 2) / 32)));
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), lanes.length - count));
  return { lanes: lanes.slice(start, start + count), start, total: lanes.length,
    width: Math.floor((width - (count - 1) * 2) / count) };
}

function moveOnBoard(view, key) {
  if (!view.boardActive || !['left', 'right', 'up', 'down', 'j', 'k', 'home', 'end', 'pageup', 'pagedown'].includes(key)) return false;
  const lanes = boardLanes(view.visible()).filter(lane => lane.items.length);
  const column = lanes.findIndex(lane => lane.items.some(item => item.index === view.cursor));
  if (column < 0) return true;
  const lane = lanes[column];
  const row = lane.items.findIndex(item => item.index === view.cursor);
  if (key === 'left' || key === 'right') {
    const next = lanes[column + (key === 'right' ? 1 : -1)];
    if (next) view.cursor = next.items[Math.min(row, next.items.length - 1)].index;
    return true;
  }
  const step = key.startsWith('page') ? Math.max(1, view.boardPageSize || 1) : 1;
  const delta = ['up', 'k', 'pageup'].includes(key) ? -step : step;
  const target = key === 'home' ? 0 : key === 'end' ? lane.items.length - 1 : row + delta;
  view.cursor = lane.items[Math.max(0, Math.min(target, lane.items.length - 1))].index;
  return true;
}

module.exports = { MIN_BOARD_WIDTH, CARD_HEIGHT, localDay, laneName, boardLanes, boardWindow, moveOnBoard };
