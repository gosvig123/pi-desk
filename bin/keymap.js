'use strict';

// The complete key map. The footer shows only the keys that work where the
// person stands; `?` shows this list, so nothing has to stay in the frame.

const { clip, displayWidth } = require('./task-layout');

const SECTIONS = [
  ['Move around', [
    ['Tab / h l', 'next and previous tab'],
    ['1 2 3 4', 'Conversations, Ticks, Review, Tasks'],
    ['T / R', 'jump to Ticks or Review'],
    ['[ ]', 'Favorites, Today, Here, All'],
    ['?', 'this key map'],
    ['q / Esc', 'quit'],
  ]],
  ['Conversations', [
    ['↑↓ j k', 'move'],
    ['Enter', 'resume with current defaults'],
    ['o', 'resume with session model'],
    ['d', 'details'],
    ['e', 'edit name'],
    ['g / G', 'queue title / settings'],
    ['t', 'associate a task'],
    ['p', 'edit cwd'],
    ['f / Space', 'favorite'],
    ['x', 'clean stale favorites'],
    ['/', 'search'],
    ['r', 'rescan sessions'],
  ]],
  ['Ticks', [
    ['↑↓ j k', 'move'],
    ['Enter / d', 'job details'],
    ['Space', 'enable or disable'],
    ['x twice', 'run now'],
    ['r', 'reload jobs'],
  ]],
  ['Review', [
    ['↑↓ j k', 'move'],
    ['Enter', 'chat resumes, tick shows output'],
    ['d', 'details for either kind'],
    ['a / A', 'reviewed / all listed'],
    ['r', 'reload review'],
  ]],
  ['Tasks', [
    ['↑↓ j k', 'move'],
    ['← →', 'board columns'],
    ['Space', 'complete or reopen'],
    ['n / e', 'add / edit'],
    ['l / [ ]', 'list / cycle lists'],
    ['s', 'status'],
    ['Enter / d', 'details'],
    ['c', 'start linked conversation'],
    ['/', 'search'],
    ['r', 'reload tasks'],
  ]],
  ['Files', [
    ['favorites.json', 'starred conversations'],
    ['pisesh-review.json', 'review state'],
    ['pisesh-task-links.json', 'task links'],
    ['tick/jobs.json', 'tick jobs'],
  ]],
];

// Each section stays whole; columns break only between sections.
function sectionBlocks() {
  return SECTIONS.map(([title, entries]) => [
    title,
    ...entries.map(([keys, meaning]) => `  ${keys.padEnd(11)} ${meaning}`),
    '',
  ]);
}

function cutPoints(blocks, columns) {
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const per = Math.ceil(total / columns);
  const cuts = [0];
  let running = 0;
  for (let index = 0; index < blocks.length; index++) {
    running += blocks[index].length;
    if (running >= per && cuts.length < columns) { cuts.push(index + 1); running = 0; }
  }
  return [...cuts, blocks.length];
}

function naturalWidth(rows) {
  return rows.reduce((widest, row) => Math.max(widest, displayWidth(row)), 0);
}

function layoutFor(blocks, columns) {
  const cuts = cutPoints(blocks, columns);
  const groups = cuts.slice(0, -1).map((from, index) => blocks.slice(from, cuts[index + 1]).flat());
  const widths = groups.map(naturalWidth);
  return { groups, widths, total: widths.reduce((sum, value) => sum + value, 0) + 3 * (columns - 1) };
}

// Render the widest column count whose natural width fits the terminal, so a
// narrow window falls back to fewer columns instead of cutting meanings off.
function keymapLines(width, height) {
  const blocks = sectionBlocks();
  const layout = [3, 2].map(columns => layoutFor(blocks, columns)).find(item => item.total <= width)
    ?? layoutFor(blocks, 1);
  const lines = [];
  const depth = Math.max(...layout.groups.map(group => group.length));
  for (let line = 0; line < depth; line++) {
    lines.push(layout.groups
      .map((group, index) => clip(group[line] || '', layout.widths[index]).padEnd(layout.widths[index]))
      .join('   ').replace(/\s+$/, ''));
  }
  return ['Keys', '', ...lines].slice(0, Math.max(0, height)).map(row => clip(row, width));
}

module.exports = { SECTIONS, keymapLines };
