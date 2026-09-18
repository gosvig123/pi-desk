'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ConversationViews, CONVERSATIONS_TAB } = require('../bin/conversation-views');

const now = new Date(2026, 9, 10, 12);
const sessions = [
  { id: 'star', favored: true, effectiveCwd: '/other', mtime: new Date(2026, 8, 1) },
  { id: 'today', favored: false, effectiveCwd: '/other', mtime: now },
  { id: 'here', favored: false, effectiveCwd: '/work/', mtime: new Date(2026, 8, 1) },
];

test('one Conversations tab switches existing views without merging or mutating sessions', () => {
  const views = new ConversationViews();
  assert.equal(CONVERSATIONS_TAB, 'Conversations');
  for (const expected of [['star'], ['today'], ['here'], ['star', 'today', 'here']]) {
    assert.deepEqual(views.filter(sessions, '/work', now).map(session => session.id), expected);
    assert.equal(views.handle(']'), true);
  }
  assert.equal(views.current, '★ Favorites');
  views.handle('[');
  assert.equal(views.current, 'All');
  assert.equal(views.filter(sessions, '/work', now), sessions);
  assert.equal(views.handle('x'), false);
  assert.match(views.labels(), /\[ All \]/);
  assert.equal(sessions.length, 3);
});

test('picker puts every destination on one navigation row and keeps view switching separate from search', () => {
  const source = fs.readFileSync(path.join(__dirname, '../bin/pisesh'), 'utf8');
  assert.match(source, /const tabs = \[CONVERSATIONS_TAB, TASKS_TAB\]/);
  assert.match(source, /conversationViews\.filter\(sessions, CURRENT_CWD\)/);
  assert.match(source, /conversationViews\.handle\(str\)/);
  assert.match(source, /mode === 'filter'\) handleFilter\(str, key\)/);
  assert.match(source, /conversationViews\.labels\(width, /);
  assert.match(source, /tabBar\(labels, tabIdx, width, /);
  assert.doesNotMatch(source, /navigationHint|CONVERSATION_MODES/);
});
