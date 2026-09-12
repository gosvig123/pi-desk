'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SECTIONS, keymapLines } = require('../bin/keymap');
const { displayWidth } = require('../bin/task-layout');

const source = fs.readFileSync(path.join(__dirname, '../bin/pisesh'), 'utf8');

test('the key map covers every tab and every documented key', () => {
  const titles = SECTIONS.map(([title]) => title);
  assert.deepEqual(titles, ['Move around', 'Conversations', 'Ticks', 'Review', 'Tasks', 'Files']);
  const all = SECTIONS.flatMap(([, entries]) => entries.map(([keys, meaning]) => `${keys} ${meaning}`)).join('\n');
  for (const needle of ['1 2 3 4', '?', 'Tab / h l', 'x twice', 'a / A', 'pisesh-review.json']) {
    assert.ok(all.includes(needle), needle);
  }
  assert.ok(SECTIONS.every(([, entries]) => entries.every(([keys, meaning]) => keys && meaning)));
});

test('the map uses the widest column count that fits without cutting a meaning', () => {
  const wide = keymapLines(130, 200);
  const narrow = keymapLines(60, 200);
  assert.ok(wide.length < narrow.length, 'wide terminals get fewer rows');
  for (const width of [130, 100, 60, 30]) {
    const rows = keymapLines(width, 26);
    assert.ok(rows.length <= 26);
    assert.ok(rows.every(row => displayWidth(row) <= width), `width ${width}`);
    assert.equal(rows[0], 'Keys');
  }
  assert.ok(wide.every(row => !row.includes('…')));
});

test('the frame keeps one navigation row, one footer line, and a key map on demand', () => {
  assert.match(source, /function tabLabels\(\)/);
  assert.match(source, /`\$\{index \+ 1\} \$\{label\}\$\{count\}`/);
  assert.match(source, /function footerText\(\)/);
  assert.match(source, /function renderHelpOverlay\(\) \{\n/);
  assert.match(source, /if \(helpOpen\) return renderHelpOverlay\(\)/);
  assert.match(source, /if \(str === '\?' \|\| k === '\?'\) \{ helpOpen = true; return true; \}/);
  assert.equal(source.match(/A\.D \+ trunc\((footerText\(\)|ticksView\.help\(\)|reviewView\.help\(\)|tasksView\.help\(\))/g).length, 4);
  assert.doesNotMatch(source, /navigationHint/);
});

test('tab jumps and direct keys stay out of text fields', () => {
  assert.match(source, /function handleGlobalKey\(str, key\)/);
  assert.match(source, /if \(textEntryActive\(\)\) return false;/);
  const guard = source.indexOf('if (textEntryActive()) return false;');
  const mapKey = source.indexOf("if (str === '?' || k === '?') { helpOpen = true; return true; }");
  assert.ok(guard > 0 && mapKey > guard, 'a text field keeps the ? character');
  assert.match(source, /if \(str === 'T'\) return focusTab\(tabs\.indexOf\(TICKS_TAB\)\)/);
  assert.match(source, /if \(str === 'R'\) return focusTab\(tabs\.indexOf\(REVIEW_TAB\)\)/);
  assert.match(source, /\['1', '2', '3', '4'\]\.indexOf\(str\)/);
  assert.match(source, /function textEntryActive\(\) \{\n  if \(\['filter', 'edit', 'browse', 'model'\]\.includes\(mode\)\) return true;/);
  assert.match(source, /tasksView\.mode === 'search'/);
});

test('the footer asks for the key map, fits 62 columns, and drops the old tab keys', () => {
  assert.match(source, /if \(str === '\?' \|\| k === '\?'\)/);
  const footers = [source.match(/return '(↑↓ move · \? keys[^']*)';/)[1],
    new (require('../bin/ticks-view').TicksView)(() => {}).help(),
    new (require('../bin/review-view').ReviewView)(() => {}).help()];
  for (const footer of footers) {
    assert.match(footer, /^↑↓ move · \? keys/, footer);
    assert.doesNotMatch(footer, /T ticks|R review|Tab tab/);
  }
  const tasks = require('../bin/tasks-view').TasksView.prototype.help;
  const board = tasks.call({ actions: {}, picker: null, mode: 'closed', boardActive: true }, 120);
  const wide = tasks.call({ actions: {}, picker: null, mode: 'closed', boardActive: false }, 120);
  assert.ok(displayWidth(board) <= 62, board);
  assert.ok(displayWidth(wide) <= 100, wide);
  for (const text of [board, wide]) assert.match(text, /\? keys/);
});
