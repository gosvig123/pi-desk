'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tabBar } = require('../bin/tab-bar');
const { CONVERSATION_VIEWS, ConversationViews } = require('../bin/conversation-views');

const tabs = ['1 Conversations', '2 Ticks (3)', '3 Review', '4 Tasks'];
const style = text => `\x1b[7m${text}\x1b[0m`;
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, '');

test('tab bars preserve padding and visible separators before applying selection styles', () => {
  assert.equal(tabBar(tabs, 0, 80), '[ 1 Conversations ]   │     2 Ticks (3)     │     3 Review     │     4 Tasks  ');
  assert.equal(tabBar(tabs, 3, 80, style),
    '  1 Conversations     │     2 Ticks (3)     │     3 Review     │   \x1b[7m[ 4 Tasks ]\x1b[0m');
  assert.equal(new ConversationViews().labels(80), '[ ★ Favorites ]   │     Today     │     Here     │     All  ');
});

test('every tab label fits the width or the active label wins', () => {
  for (const labels of [tabs, CONVERSATION_VIEWS]) {
    for (let selected = 0; selected < labels.length; selected++) {
      for (const width of [1, 10, 20, 30, 38, 58, 78, 98]) {
        const line = tabBar(labels, selected, width, style);
        assert.ok(plain(line).length <= width, `${width}: ${line}`);
        assert.ok(line.endsWith('\x1b[0m') || line.includes('\x1b[0m'));
        if (width >= 20) assert.ok(plain(line).includes(labels[selected]));
      }
    }
  }
});

test('view labels follow both bracket keys with wraparound and preserve selection at narrow widths', () => {
  const views = new ConversationViews();
  views.handle('[');
  assert.equal(views.labels(20), '[ All ]');
  views.handle(']');
  assert.equal(views.labels(20), '[ ★ Favorites ]');
  views.handle(']');
  assert.equal(views.labels(20), '[ Today ]');
});
