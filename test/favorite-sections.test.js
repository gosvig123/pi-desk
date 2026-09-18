'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { favoriteSections, isSnoozed, snoozeDeadline, sectionRows } = require('../bin/favorite-sections');
const { displayWidth, clip } = require('../bin/task-layout');

const now = Date.parse('2026-09-12T10:00:00Z');

test('snooze supports no timer, minute/hour/day/week timers, and rejects invalid input', () => {
  assert.equal(snoozeDeadline(''), null);
  for (const [input, minutes] of [['30m', 30], ['2H', 120], ['1d', 1440], ['1w', 10080]]) {
    assert.equal(Date.parse(snoozeDeadline(input, now)), now + minutes * 60000);
  }
  for (const input of ['0m', '-1h', '2', 'tomorrow', '999999999999999999w', '366d']) {
    assert.throws(() => snoozeDeadline(input, now), /Use 30m/);
  }
});

test('expired conversations return to Favorites; indefinite snoozes do not expire', () => {
  const sessions = [
    { id: 'active', favored: true },
    { id: 'manual', favored: true, snoozedUntil: null },
    { id: 'timer', favored: true, snoozedUntil: snoozeDeadline('30m', now) },
    { id: 'other', favored: false },
  ];
  const runs = [{ id: 'job', key: 'one' }, { id: 'job', key: 'two' }];
  const groups = favoriteSections(sessions, runs, now);
  assert.deepEqual(groups.map(group => group.items.map(item => item.id)), [['active'], ['manual', 'timer'], ['job', 'job']]);
  const expired = favoriteSections(sessions, runs, now + 30 * 60000);
  assert.deepEqual(expired[0].items.map(item => item.id), ['active', 'timer']);
  assert.deepEqual(expired[1].items.map(item => item.id), ['manual']);
  assert.equal(isSnoozed(sessions[0], now), false);
  assert.equal(isSnoozed({ snoozedUntil: 'bad' }, now), false);
  assert.equal(sessions[2].favored, true);
});

test('three stacked sections keep the selected row visible, skip empty groups, and fit', () => {
  const sections = [
    { label: 'Favorites', items: Array.from({ length: 20 }, (_, i) => ({ id: `f${i}` })) },
    { label: 'Snoozed', items: [] },
    { label: 'Tick results', items: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, reviewed: i > 0 })) },
  ];
  for (const width of [38, 78, 118]) for (const height of [6, 12, 24]) {
    for (const cursor of [0, 19, 20, 39]) {
      const rows = sectionRows(sections, cursor, height, width, (item, w, selected) => clip(`${selected ? '▶' : ' '} ${item.id}`, w));
      assert.equal(rows.length, height);
      assert.ok(rows.every(row => displayWidth(row) <= width));
      assert.equal(rows.filter(row => row.startsWith('▶')).length, 1);
      assert.ok(rows.find(row => row.startsWith('Favorites')));
      assert.ok(rows.find(row => row.startsWith('Snoozed')));
      assert.match(rows.find(row => row.startsWith('Tick results')), /1 new/);
    }
  }
  const empty = favoriteSections([], []);
  assert.equal(sectionRows(empty, 0, 3, 38, () => '').length, 3);
});
