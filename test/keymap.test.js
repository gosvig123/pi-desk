'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { SECTIONS, keymapLines } = require('../bin/keymap');
const { displayWidth } = require('../bin/task-layout');

test('key map describes two tabs, snoozes and finished results, not job controls', () => {
  const text = SECTIONS.flatMap(([title, entries]) => [title, ...entries.flat()]).join('\n');
  assert.match(text, /Tab \/ 1 2/);
  assert.match(text, /snooze \/ restore/);
  assert.match(text, /mark selected tick reviewed/);
  assert.doesNotMatch(text, /enable or disable|run now|jump to Ticks|reload review/);
  for (const width of [130, 100, 60, 30]) {
    const rows = keymapLines(width, 26);
    assert.ok(rows.length <= 26 && rows.every(row => displayWidth(row) <= width));
    assert.equal(rows[0], 'Keys');
  }
});

test('picker renders three sections, persists snoozes and review marks, and keeps task navigation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-ui-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(__dirname, '../bin/pisesh');
  const checks = `
    tasksView.started = true;
    fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
    fs.mkdirSync(process.env.PI_TICK_DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_ROOT, 'focus.jsonl'), [
      { type: 'session', id: 'focus', timestamp: new Date().toISOString(), cwd: '/repo/project' },
      { type: 'message', message: { role: 'user', content: 'Fix session switching' } },
    ].map(value => JSON.stringify(value)).join('\\n'));
    favorites.add('focus'); saveFavorites(favorites);
    saveTitle('focus', 'Fix session switching', 'llm', 'provider/model', 'high');
    fs.writeFileSync(path.join(process.env.PI_TICK_DATA_DIR, 'runs.jsonl'), ['one', 'two'].map(runId => JSON.stringify({
      jobId: 'same-job', runId, finishedAt: new Date().toISOString(), exitCode: 0, finalTextPreview: 'Result ' + runId,
    })).join('\\n'));
    sessions = scanSessions(); reloadResults();
    let output = '';
    process.stdout.write = text => { output += text; return true; };
    const plain = () => output.replace(/\\x1b\\[[0-9;]*[A-Za-z]/g, '');
    for (const width of [40, 80, 120]) {
      process.stdout.columns = width; process.stdout.rows = 30;
      output = ''; render();
      const screen = plain();
      for (const heading of ['Favorites (', 'Snoozed (', 'Tick results (']) assert.ok(screen.includes(heading), screen);
      assert.ok(screen.includes('1 Conversations') && screen.includes('2 Tasks'));
      assert.ok(!screen.includes('3 Review') && !screen.includes('pi-desk'));
      assert.ok(!screen.includes('provider/model') && !screen.includes('◆'));
      assert.ok(screen.split('\\n').every(row => displayWidth(row) <= width), screen);
      assert.ok(screen.split('\\n').length <= 30);
      if (width >= 80) {
        const row = screen.split('\\n').find(row => row.includes('Fix session switching'));
        assert.ok(row.indexOf('Fix session switching') < row.indexOf('project'));
      }
      focusTab(1);
      tasksView.actions.form = new (require('./task-form').TaskForm)({ title: 'Task', list: 'work' }, false);
      output = ''; render();
      assert.equal(output.split('Ctrl-S save').length - 1, 1);
      tasksView.actions.form = null;
      focusTab(0);
    }
    handleList('', { name: 'right' }); assert.equal(tabIdx, 0);
    handleList('', { name: 'tab' }); assert.equal(tabIdx, 1);
    assert.equal(tasksView.handle('l', { name: 'l' }), true);
    assert.ok(tasksView.picker); tasksView.picker = null;
    assert.equal(handleGlobalKey('1', { name: '1' }), true); assert.equal(tabIdx, 0);
    handleList('s', { name: 's' }); assert.equal(mode, 'snooze');
    assert.equal(handleGlobalKey('2', { name: '2' }), false);
    handleSnooze('30m', {}); handleSnooze('', { name: 'return' });
    assert.equal(mode, 'list');
    assert.equal(visibleSections()[0].items.length, 0);
    assert.equal(visibleSections()[1].items[0].id, 'focus');
    assert.ok(Date.parse(JSON.parse(fs.readFileSync(META_FILE)).overrides.focus.snoozedUntil) > Date.now());
    handleList('s', { name: 's' });
    assert.equal(visibleSections()[0].items[0].id, 'focus');
    startSnooze(sessions[0]); handleSnooze('', { name: 'return' });
    meta = loadMeta().overrides; sessions = scanSessions();
    assert.equal(visibleSections()[1].items[0].snoozedUntil, null);
    meta.focus.snoozedUntil = new Date(Date.now() - 1).toISOString(); saveMeta();
    assert.equal(visibleSections()[0].items[0].id, 'focus');
    assert.equal(visibleSections()[1].items.length, 0);
    cursor = visibleItems().findIndex(item => item.runId === 'one');
    handleList('e', { name: 'e' }); assert.equal(mode, 'list');
    handleList('', { name: 'return' }); assert.equal(mode, 'result');
    output = ''; render(); assert.ok(output.includes('Result one'));
    assert.ok(output.includes('reviewed'));
    handleResult({ name: 'escape' }); reloadResults();
    assert.equal(tickResults.length, 2);
    assert.equal(tickResults.find(item => item.runId === 'one').reviewed, true);
    assert.equal(tickResults.find(item => item.runId === 'two').reviewed, false);
    assert.equal(new ReviewStore(reviewStore.file).has('tick:same-job:one'), true);
    cursor = 0; handleList('d', { name: 'd' }); handleDetails('f', { name: 'f' });
    assert.equal(visibleItems()[0].kind, 'tick');
    output = ''; render();
    assert.ok(output.includes('Fix session switching') && output.includes('first prompt:'));
    handleDetails('', { name: 'escape' });
    startEdit(sessions[0]); handleEdit('Manual title', {}); handleEdit('', { name: 'return' });
    assert.ok(JSON.parse(fs.readFileSync(META_FILE)).overrides.focus.title.endsWith('Manual title'));
  `;
  const script = `const file = ${JSON.stringify(file)};
    require('node:vm').runInNewContext(require('node:fs').readFileSync(file, 'utf8') + ${JSON.stringify(checks)}, {
      require: require('node:module').createRequire(file), __dirname: require('node:path').dirname(file),
      module: { exports: {} }, process, Buffer, console, assert: require('node:assert/strict'),
      setTimeout, clearTimeout
    });`;
  const env = { ...process.env, PI_AGENT_DIR: dir, PI_CODING_AGENT_DIR: dir,
    PI_SESSION_DIR: path.join(dir, 'sessions'), PI_TICK_DATA_DIR: path.join(dir, 'tick') };
  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const help = spawnSync(process.execPath, [file, '--help'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /snooze \/ restore/);
  assert.doesNotMatch(help.stdout, /jobs.json|run now/);
});
