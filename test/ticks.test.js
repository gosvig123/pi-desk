'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTicks, processIsAlive } = require('../bin/ticks-data');
const { scheduleLabel, nextFireAt, relativeTime } = require('../bin/tick-schedule');
const { tickRows, tickDetailRows, tickSummary } = require('../bin/tick-presentation');
const { TicksView } = require('../bin/ticks-view');
const { displayWidth } = require('../bin/task-layout');
const { styleTickRow } = require('../bin/task-styles');
const { stripVTControlCharacters } = require('node:util');

function fixtureDir(jobs, active = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desk-ticks-'));
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ version: 1, jobs }));
  fs.mkdirSync(path.join(dir, 'active'));
  active.forEach((record, index) => {
    fs.writeFileSync(path.join(dir, 'active', `${index}.json`), JSON.stringify(record));
  });
  return dir;
}

const job = (id, extra = {}) => ({ id, prompt: `do ${id}`, cwd: '/tmp', schedule: { kind: 'daily', value: { time: '09:00' } },
  enabled: true, model: null, lastRun: null, ...extra });
const key = (view, name, str = name) => view.handle(str, { name });
const viewFor = (jobs, actions = { run: async () => {}, toggle: async () => {} }) =>
  new TicksView(() => {}, async () => ({ jobs, error: '' }), actions);

test('loadTicks reads the catalog and marks only jobs with a live runner pid', async () => {
  const dir = fixtureDir([job('alpha'), job('beta'), { prompt: 'no id' }],
    [{ jobId: 'alpha', pid: process.pid }, { jobId: 'beta', pid: 0x7ffffff }]);
  const { jobs, error } = await loadTicks(dir);
  assert.equal(error, '');
  assert.deepEqual(jobs.map(item => [item.id, item.running]), [['alpha', true], ['beta', false]]);
  assert.equal(processIsAlive(0), false);
});

test('loadTicks normalizes the last run into the fields the presentation reads', async () => {
  const dir = fixtureDir([job('alpha', { lastRun: { startedAt: '2026-09-11T08:00:00.000Z',
    finishedAt: '2026-09-11T08:00:42.000Z', exitCode: 124, reason: 'output_cap',
    transcriptPath: '/tmp/runs/alpha/run.jsonl', finalTextPreview: 'stopped early' } })]);
  const [alpha] = (await loadTicks(dir)).jobs;
  assert.deepEqual(alpha.lastRun, { startedAt: '2026-09-11T08:00:00.000Z',
    finishedAt: '2026-09-11T08:00:42.000Z', exitCode: 124, reason: 'output_cap', error: '',
    transcriptPath: '/tmp/runs/alpha/run.jsonl', preview: 'stopped early' });
});

test('loadTicks reports a broken catalog without throwing and a missing one as empty', async () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desk-ticks-'));
  fs.writeFileSync(path.join(broken, 'jobs.json'), 'not json');
  assert.match((await loadTicks(broken)).error, /jobs\.json/);
  assert.deepEqual(await loadTicks(path.join(broken, 'absent')), { jobs: [], error: '' });
});

test('schedule labels and next fires follow the tick catalog semantics in local time', () => {
  const now = new Date(2026, 8, 11, 10, 30);
  assert.equal(scheduleLabel({ kind: 'daily', value: { time: '09:00' } }), 'daily @ 09:00');
  assert.equal(scheduleLabel({ kind: 'weekly', value: { days: ['friday'], time: '08:00' } }), 'weekly friday @ 08:00');
  assert.equal(scheduleLabel({ kind: 'interval', value: { minutes: 30, seconds: 0 } }), 'every 30m');
  assert.equal(scheduleLabel({ kind: 'cron' }), 'unscheduled');
  assert.equal(nextFireAt({ kind: 'daily', value: { time: '09:00' } }, now).getDate(), 12);
  assert.equal(nextFireAt({ kind: 'daily', value: { time: '18:00' } }, now).getDate(), 11);
  assert.equal(nextFireAt({ kind: 'weekly', value: { days: ['friday'], time: '08:00' } }, now).getDate(), 18);
  assert.equal(nextFireAt({ kind: 'interval', value: { minutes: 15 } }, now).getMinutes(), 45);
  assert.equal(nextFireAt({ kind: 'cron' }, now), null);
  assert.equal(relativeTime(new Date(now.getTime() - 7200_000).toISOString(), now), '2h ago');
});

test('tick rows stay inside the width and show state, schedule and last run', () => {
  const wide = job('alpha', { lastRun: { startedAt: '2026-09-11T08:00:00.000Z',
    finishedAt: '2026-09-11T08:00:42.000Z', exitCode: 0, transcriptPath: '/tmp/a.jsonl' } });
  const view = { cursor: 0, visible: () => [wide] };
  const row = tickRows(view, 3, 200)[0];
  assert.match(row, /^▶ {3}alpha · active · daily @ 09:00 · next \d{2}-\d{2} \d{2}:\d{2} · last .+ · ok$/);
  assert.match(tickRows({ cursor: 0, visible: () => [job('beta', { enabled: false })] }, 3, 200)[0],
    /disabled · daily @ 09:00 · not scheduled · last never run/);
  for (const width of [4, 10, 20, 38, 78, 118]) {
    assert.ok(displayWidth(tickRows(view, 3, width)[0]) <= width);
  }
});

test('details cover schedule, cwd, last run and prompt without exceeding the width', () => {
  const view = { cursor: 0, visible: () => [job('alpha', { lastRun: { startedAt: '2026-09-11T08:00:00.000Z',
    finishedAt: '2026-09-11T08:00:42.000Z', exitCode: 124, reason: 'output_cap',
    transcriptPath: '/tmp/runs/alpha/run.jsonl', preview: 'stopped early' } })] };
  const text = tickDetailRows(view.visible()[0], 60).join('\n');
  assert.match(text, /active · daily @ 09:00/);
  assert.match(text, /cwd: \/tmp/);
  assert.match(text, /exit 124 \(output_cap\)/);
  assert.match(text, /Last output\nstopped early/);
  assert.match(text, /do alpha/);
  assert.equal(tickDetailRows(null, 60)[0], 'Job no longer exists.');
});

test('view navigation, details and the two-step run guard never leak session keys', async () => {
  const calls = [];
  const view = await viewFor([job('alpha'), job('beta')],
    { run: async id => calls.push(['run', id]), toggle: async (id, enabled) => calls.push(['toggle', id, enabled]) });
  await view.reload();
  assert.equal(tickSummary(view), '1/2 · 2 active');
  key(view, 'down');
  assert.equal(tickSummary(view), '2/2 · 2 active');
  key(view, 'return');
  assert.equal(view.mode, 'details');
  key(view, 'escape');
  key(view, 'space', ' ');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['toggle', 'beta', false]]);
  key(view, 'x');
  assert.deepEqual(calls, [['toggle', 'beta', false]]);
  key(view, 'x');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ['run', 'beta']);
  assert.equal(tickRows(view, 1, 20).length, 1);
});

test('styles mark the selected tick row and keep styled text equal to plain text', async () => {
  const view = await viewFor([job('alpha'), job('beta', { enabled: false })]);
  await view.reload();
  for (const width of [20, 38, 78]) {
    const styled = view.renderLines(6, width);
    assert.deepEqual(styled.map(row => stripVTControlCharacters(row).trimEnd()),
      view.lines(6, width).map(row => row.trimEnd()));
    assert.ok(styled.every(row => displayWidth(stripVTControlCharacters(row)) <= width));
    assert.ok(styled.some(row => row.startsWith('\x1b[7m')));
  }
  assert.match(styleTickRow('  ↩ beta · disabled · daily @ 09:00 · last never run', 78), /^\x1b\[2m/);
  assert.equal(styleTickRow('  ↩ beta · active · daily @ 09:00 · last never run', 78), '  ↩ beta · active · daily @ 09:00 · last never run');
});

test('the picker hosts Ticks as one row of the single navigation bar', () => {
  const source = fs.readFileSync(path.join(__dirname, '../bin/pisesh'), 'utf8');
  assert.match(source, /const tabs = \[CONVERSATIONS_TAB, TICKS_TAB, REVIEW_TAB, TASKS_TAB\]/);
  assert.match(source, /if \(tabs\[tabIdx\] === TICKS_TAB\) return renderTicks\(\)/);
  assert.match(source, /else if \(tabs\[tabIdx\] === TICKS_TAB\) handleViewTab\(ticksView, str, key\)/);
  assert.match(source, /tabBar\(tabLabels\(\), tabIdx, width, /);
  assert.match(source, /ticksView\.renderLines\(/);
});
