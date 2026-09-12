'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectReview, readSessionTail, readTranscriptTail, readRuns, REVIEW_WINDOW_DAYS } = require('../bin/review-data');
const { ReviewStore } = require('../bin/review-store');
const { ReviewView } = require('../bin/review-view');
const { reviewSummary, reviewDetailRows } = require('../bin/review-presentation');
const { displayWidth } = require('../bin/task-layout');
const { stripVTControlCharacters } = require('node:util');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desk-review-'));
const line = value => JSON.stringify(value) + '\n';
const key = (view, name, str = name) => view.handle(str, { name });

// A conversation ends with an assistant reply; the review list only holds work
// that finished.
function sessionFile(dir, name, records) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, records.map(line).join(''));
  return file;
}

function session(files, name, mtime) {
  const file = files[name];
  return { id: name, file, mtime, title: name, effectiveCwd: '/tmp/project' };
}

function fixtures() {
  const dir = tmp();
  const files = {
    answered: sessionFile(dir, 'answered.jsonl', [
      { type: 'session', id: 'answered' },
      { type: 'message', message: { role: 'user', content: 'question' }, timestamp: '2026-09-12T08:00:00.000Z' },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
        timestamp: '2026-09-12T08:05:00.000Z' },
    ]),
    waiting: sessionFile(dir, 'waiting.jsonl', [
      { type: 'session', id: 'waiting' },
      { type: 'message', message: { role: 'user', content: 'question' }, timestamp: '2026-09-12T09:00:00.000Z' },
    ]),
  };
  const now = new Date('2026-09-12T12:00:00.000Z');
  const sessions = [session(files, 'answered', new Date('2026-09-12T08:05:00.000Z')),
    session(files, 'waiting', new Date('2026-09-12T09:00:00.000Z'))];
  return { dir, sessions, now };
}

test('only a conversation that ends with an assistant reply enters the review list', () => {
  const { sessions, now } = fixtures();
  const entries = collectReview({ sessions, reviewed: { has: () => false }, dir: '/nonexistent', now });
  assert.deepEqual(entries.map(entry => [entry.kind, entry.id, entry.outcome]), [['conversation', 'answered', 'replied']]);
  assert.equal(entries[0].text, 'the answer');
  assert.match(entries[0].key, /^session:answered:2026-09-12T08:05:00\.000Z$/);
});

test('the current conversation, acknowledged keys, and stale items stay out of the list', () => {
  const { sessions, now } = fixtures();
  const current = collectReview({ sessions, currentId: 'answered', reviewed: { has: () => false }, dir: '/nonexistent', now });
  assert.deepEqual(current, []);
  const answeredKey = 'session:answered:2026-09-12T08:05:00.000Z';
  const acknowledged = collectReview({ sessions, reviewed: { has: key => key === answeredKey }, dir: '/nonexistent', now });
  assert.deepEqual(acknowledged, []);
  const old = [{ ...sessions[0], mtime: new Date('2026-08-01T00:00:00.000Z') }];
  assert.deepEqual(collectReview({ sessions: old, reviewed: { has: () => false }, dir: '/nonexistent', now }), []);
  assert.equal(REVIEW_WINDOW_DAYS, 14);
});

test('tick runs become one entry per run with the transcript output and failure state', () => {
  const dir = tmp();
  const transcript = path.join(dir, 'run.jsonl');
  fs.writeFileSync(transcript, [line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'tick output' }] } }),
    line({ type: 'agent_settled' })].join(''));
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), [
    line({ runId: 'r1', jobId: 'job-a', exitCode: 0, reason: 'exit_code', finishedAt: '2026-09-12T08:00:00.000Z',
      startedAt: '2026-09-12T07:59:00.000Z', transcriptPath: transcript, tokens: { input: 1, output: 2 }, triggerKind: 'external' }),
    line({ runId: 'r2', jobId: 'job-b', exitCode: 124, reason: 'output_cap', finishedAt: '2026-09-12T09:00:00.000Z',
      startedAt: '2026-09-12T08:50:00.000Z' }),
    line({ runId: 'r3', jobId: 'job-old', exitCode: 0, finishedAt: '2026-08-01T00:00:00.000Z', startedAt: '2026-08-01T00:00:00.000Z' }),
  ].join(''));
  const entries = collectReview({ sessions: [], reviewed: { has: () => false }, dir, now: new Date('2026-09-12T12:00:00.000Z') });
  assert.deepEqual(entries.map(entry => [entry.id, entry.runId, entry.outcome]), [['job-b', 'r2', 'failed'], ['job-a', 'r1', 'ok']]);
  assert.equal(entries[1].text, 'tick output');
  assert.equal(entries[0].text, '');
  assert.equal(entries[1].key, 'tick:job-a:r1');
});

test('conversations and ticks mix newest first and both appear in the summary', () => {
  const { sessions, now } = fixtures();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), line({ runId: 'r1', jobId: 'job-a', exitCode: 0,
    reason: 'exit_code', finishedAt: '2026-09-12T11:00:00.000Z', startedAt: '2026-09-12T10:59:00.000Z' }) + '\n');
  const entries = collectReview({ sessions, reviewed: { has: () => false }, dir, now });
  assert.deepEqual(entries.map(entry => entry.kind), ['tick', 'conversation']);
  const view = { cursor: 0, visible: () => entries };
  assert.equal(reviewSummary(view), '1/2 · 1 chat · 1 tick');
});

test('details show the reply for a conversation and the run facts for a tick', () => {
  const { sessions, now } = fixtures();
  const [chat] = collectReview({ sessions, reviewed: { has: () => false }, dir: '/nonexistent', now });
  const chatText = reviewDetailRows(chat, 60, now).join('\n');
  assert.match(chatText, /Last reply\nthe answer/);
  assert.match(chatText, /Enter resumes from the list/);
  const tick = { kind: 'tick', id: 'job-a', runId: 'r1', title: 'job-a', outcome: 'failed', reason: 'output_cap',
    startedAt: '2026-09-12T10:00:00.000Z', completedAt: '2026-09-12T10:04:08.000Z', tokens: null, text: '' };
  const tickText = reviewDetailRows(tick, 60, now).join('\n');
  assert.match(tickText, /run r1 · failed \(output_cap\) · 4m 8s/);
  assert.match(tickText, /No readable output in this transcript\./);
  assert.equal(reviewDetailRows(null, 60)[0], 'This entry is no longer in the list.');
});

test('store keeps the newest keys, drops stale ones, and reports a first run', () => {
  const file = path.join(tmp(), 'pisesh-review.json');
  const store = new ReviewStore(file);
  assert.equal(store.fresh, true);
  assert.equal(store.has('k'), false);
  store.mark('tick:a:1', new Date('2026-09-12T10:00:00.000Z'));
  assert.equal(store.has('tick:a:1'), true);
  assert.equal(store.fresh, false);
  const reopened = new ReviewStore(file);
  assert.equal(reopened.has('tick:a:1'), true);
  assert.equal(reopened.fresh, false);
  reopened.mark('tick:a:2', new Date('2027-06-01T00:00:00.000Z'));
  assert.deepEqual(Object.keys(reopened.reviewed), ['tick:a:2']);
  assert.equal(fs.readFileSync(file, 'utf8').length > 0, true);
});

test('the view lists entries, opens a conversation once, and marks reviewed without opening', async () => {
  const { sessions, now } = fixtures();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), line({ runId: 'r1', jobId: 'job-a', exitCode: 0,
    reason: 'exit_code', finishedAt: '2026-09-12T11:00:00.000Z', startedAt: '2026-09-12T10:59:00.000Z' }) + '\n');
  const marked = [];
  const opened = [];
  const view = new ReviewView(() => {}, {
    load: async () => collectReview({ sessions, reviewed: { has: () => false }, dir, now }),
    store: { mark: keys => marked.push(...keys) },
    openConversation: entry => opened.push(entry.id),
  });
  await view.reload();
  assert.deepEqual(view.visible().map(entry => entry.kind), ['tick', 'conversation']);
  key(view, 'down');
  key(view, 'return');
  assert.deepEqual(opened, ['answered']);
  assert.deepEqual(marked, ['session:answered:2026-09-12T08:05:00.000Z']);
  marked.length = 0;
  await view.reload();
  await new Promise(resolve => setImmediate(resolve));
  view.mode = 'list';
  view.cursor = 0;
  key(view, 'a');
  assert.deepEqual(marked, ['tick:job-a:r1']);
  view.visible().forEach(entry => { entry.key = null; });
  assert.equal(key(view, 'A'), true);
});

test('a first run starts empty and a tick entry opens readable details', async () => {
  const { sessions, now } = fixtures();
  const marked = [];
  const view = new ReviewView(() => {}, {
    load: async () => collectReview({ sessions, reviewed: { has: () => false }, dir: '/nonexistent', now }),
    store: { fresh: true, mark: keys => marked.push(...keys) },
  });
  await view.reload();
  assert.deepEqual(view.visible(), []);
  assert.equal(marked.length, 1);
  assert.match(view.notice, /Review starts empty/);
  const tick = { kind: 'tick', key: 'tick:a:1', id: 'a', runId: 'r1', title: 'a', outcome: 'ok', reason: 'exit_code',
    startedAt: '2026-09-12T10:00:00.000Z', completedAt: '2026-09-12T10:01:00.000Z', tokens: null, text: 'output line' };
  const single = new ReviewView(() => {}, { load: async () => [tick], store: { mark: () => {} } });
  await single.reload();
  key(single, 'return');
  assert.equal(single.mode, 'details');
  assert.equal(single.detailsEntry, tick);
  assert.match(single.renderLines(12, 60).join('\n'), /Output\noutput line/);
  for (const width of [24, 40, 78]) {
    const styled = single.renderLines(12, width);
    assert.deepEqual(styled.map(row => stripVTControlCharacters(row).trimEnd()),
      single.lines(12, width).map(row => row.trimEnd()));
    assert.ok(styled.every(row => displayWidth(stripVTControlCharacters(row)) <= width));
  }
  key(single, 'escape');
  assert.equal(single.mode, 'list');
});

test('the open details keep the acknowledged entry after the list shrinks', async () => {
  const first = { kind: 'tick', key: 'tick:a:1', id: 'a', runId: 'r1', title: 'alpha', outcome: 'ok', reason: 'exit_code',
    startedAt: '2026-09-12T10:00:00.000Z', completedAt: '2026-09-12T10:01:00.000Z', tokens: null, text: 'alpha output' };
  const second = { ...first, key: 'tick:b:1', id: 'b', runId: 'r1', title: 'beta', text: 'beta output' };
  let entries = [first, second];
  const view = new ReviewView(() => {}, {
    load: async () => entries,
    store: { mark: keys => { entries = entries.filter(entry => !keys.includes(entry.key)); } },
  });
  await view.reload();
  view.cursor = 1;
  key(view, 'd');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.visible().length, 1);
  assert.equal(view.detailsEntry.title, 'beta');
  assert.match(view.renderLines(12, 60).join('\n'), /tick beta/);
  assert.doesNotMatch(view.renderLines(12, 60).join('\n'), /tick alpha/);
});

test('a notice renders once and then leaves the header clean', async () => {
  const tick = { kind: 'tick', key: 'tick:a:1', id: 'a', runId: 'r1', title: 'alpha', outcome: 'ok', reason: 'exit_code',
    startedAt: '2026-09-12T10:00:00.000Z', completedAt: '2026-09-12T10:01:00.000Z', tokens: null, text: 'output line' };
  let entries = [tick];
  const view = new ReviewView(() => {}, {
    load: async () => entries,
    store: { mark: () => { entries = []; } },
  });
  await view.reload();
  key(view, 'a');
  assert.match(view.renderLines(8, 60).join('\n'), /reviewed alpha/);
  assert.doesNotMatch(view.renderLines(8, 60).join('\n'), /reviewed alpha/);
});

test('tail readers accept both transcript shapes and stay inside their window', () => {
  const dir = tmp();
  const piSession = sessionFile(dir, 's.jsonl', [
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] }, timestamp: 'T1' },
    { type: 'message', message: { role: 'user', content: 'later question' }, timestamp: 'T2' },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'last' }] }, timestamp: 'T3' },
  ]);
  assert.deepEqual(readSessionTail(piSession), { role: 'assistant', timestamp: 'T3', text: 'last' });
  assert.deepEqual(readSessionTail(path.join(dir, 'missing.jsonl')), null);
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, line({ type: 'agent_settled' }));
  assert.equal(readTranscriptTail(transcript), '');
  assert.deepEqual(readRuns('/nonexistent'), []);
});
