'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pisesh = path.join(__dirname, '../bin/pisesh');
const extension = path.join(__dirname, '../extensions/sesh.ts');

test('both tabs are wired to the task link, and the entrypoint stays thin', () => {
  const source = fs.readFileSync(pisesh, 'utf8');
  assert.match(source, /else if \(mode === 'task'\) handleTaskPicker\(str, key\)/);
  assert.match(source, /if \(mode === 'task'\) return linkPicker\.render\(\)/);
  assert.match(source, /else if \(k === 't'\) openTaskPicker\(list\[cursor\]\)/);
  assert.match(source, /if \(k === 't' && s\) openTaskPicker\(s\)/);
  assert.match(source, /applyTaskLinkChoice\(setTaskLink, linkPicker\.session\.id, result/);
  assert.match(source, /startConversation: startTaskConversation, linkedConversations: taskId => conversationsForTask\(sessions, taskId\)/);
  assert.match(source, /\.\.\.taskConversationEnv\(task\)/);
  assert.match(source, /const chip = taskChip\(s\.task, index, A\)/);
  assert.match(source, /taskDetailRows\(s\.task, taskIndex\(tasksView\.data\.tasks\), A, W\)/);
  assert.match(source, /taskSearchText\(s\.task, index\)\.includes\(q\)/);
  // The picker screen, the picker model, the storage, and the launch contract
  // live in their own modules.
  for (const module of ['task-links', 'task-link-meta', 'task-link-picker', 'task-picker', 'task-conversation', 'picker-run']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'bin', `${module}.js`)), `${module}.js is missing`);
  }
});

test('the extension delegates the picker, the task handoff, and the resume handoff', () => {
  const source = fs.readFileSync(extension, 'utf8');
  assert.match(source, /import \{ runPicker \} from "\.\.\/bin\/picker-run\.js"/);
  assert.match(source, /import \{\n\trecordPendingTaskLink,\n\tstartTaskConversation,\n\} from "\.\.\/bin\/task-conversation\.js"/);
  assert.match(source, /await applyPendingSwitch\(pending, ctx, pi\)/);
  assert.doesNotMatch(source, /spawn\(/);
  assert.ok(source.split('\n').length <= 200, 'extensions/sesh.ts must stay within 200 lines');
});
