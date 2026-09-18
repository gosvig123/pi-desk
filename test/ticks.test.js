'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadTickResults, resultRow, resultDetails } = require('../bin/tick-results');
const { ReviewStore } = require('../bin/review-store');
const { displayWidth } = require('../bin/task-layout');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-results-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const run = (id, extra = {}) => ({ jobId: 'same-job', runId: id, exitCode: 0,
  finishedAt: '2026-09-12T10:00:00Z', finalTextPreview: `Result ${id}`, ...extra });

test('one row per finished run, newest first; opening/reviewing never removes a row', t => {
  const dir = fixture(t);
  const store = new ReviewStore(path.join(dir, 'review.json'));
  const records = [run('one'), run('two', { finishedAt: '2026-09-12T11:00:00Z' }),
    run('one'), run('unfinished', { finishedAt: '' }), null];
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), records.map(JSON.stringify).join('\n') + '\ninvalid\n');
  let entries = loadTickResults(store, dir);
  assert.deepEqual(entries.map(entry => entry.runId), ['two', 'one']);
  assert.ok(entries.every(entry => !entry.reviewed));
  store.mark([entries[0].key]);
  entries = loadTickResults(new ReviewStore(store.file), dir);
  assert.deepEqual(entries.map(entry => entry.reviewed), [true, false]);
  assert.equal(entries[0].title, 'Result two');
  assert.match(resultRow(entries[0], 120), /^reviewed/);
  assert.match(resultRow(entries[1], 120), /^new/);
  for (const width of [38, 78, 118]) assert.ok(displayWidth(resultRow(entries[0], width)) <= width);
});

test('output comes from the run transcript, with saved preview as a fallback', t => {
  const dir = fixture(t);
  const transcriptPath = path.join(dir, 'run.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'message_end', message: {
    role: 'assistant', content: [{ type: 'text', text: 'First line\nSecond line 界👩‍💻\u001b[31m' }],
  } }) + '\n');
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify(run('one', { transcriptPath })));
  const [entry] = loadTickResults({ has: () => false }, dir);
  const rows = resultDetails(entry, 38);
  assert.ok(rows.every(row => displayWidth(row) <= 38));
  assert.match(rows.join('\n'), /First line\nSecond line/);
  assert.ok(!rows.join('').includes('\u001b'));
  fs.unlinkSync(transcriptPath);
  assert.match(resultDetails(entry, 120).join('\n'), /transcript unavailable[\s\S]*Result one/);
});

test('remote results work without local history, stay origin-owned, and never read remote paths', t => {
  const dir = fixture(t);
  const state = path.join(dir, 'desk-sync');
  fs.mkdirSync(state);
  const localFile = path.join(dir, 'private.jsonl');
  fs.writeFileSync(localFile, JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'DO NOT READ' } }));
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ peerOrigin: 'devbox' }));
  const peer = { version: 1, origin: 'devbox', generatedAt: Date.now() / 1000, receivedAt: Date.now() / 1000,
    ticks: [{ jobId: 'same-job', runId: 'remote-one', finishedAt: '2026-09-18T07:00:00Z',
      outcome: 'ok', text: 'Remote final reply\nSecond line', error: '', transcriptPath: localFile }] };
  const save = () => fs.writeFileSync(path.join(state, 'peer.json'), JSON.stringify(peer));
  save();
  const store = new ReviewStore(path.join(dir, 'review.json'));
  let entries = loadTickResults(store, path.join(dir, 'tick'));
  assert.equal(entries.length, 1);
  assert.match(resultRow(entries[0], 200), /\[devbox\]/);
  assert.match(resultDetails(entries[0], 200).join('\n'), /Remote final reply/);
  assert.doesNotMatch(resultDetails(entries[0], 200).join('\n'), /DO NOT READ/);
  store.mark([entries[0].key]);
  entries = loadTickResults(store, path.join(dir, 'tick'));
  assert.equal(entries[0].reviewed, true);
  peer.generatedAt = 1; save();
  assert.match(resultRow(loadTickResults(store, path.join(dir, 'tick'))[0], 200), /offline\/stale/);
  peer.origin = 'unexpected'; save();
  assert.deepEqual(loadTickResults(store, path.join(dir, 'tick')), []);
});

test('missing results are empty, unreadable results report an error, and history is bounded', t => {
  const dir = fixture(t);
  const store = { has: () => false };
  assert.deepEqual(loadTickResults(store, dir), []);
  fs.mkdirSync(path.join(dir, 'runs.jsonl'));
  assert.throws(() => loadTickResults(store, dir), /Cannot read tick results/);
  fs.rmdirSync(path.join(dir, 'runs.jsonl'));
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), Array.from({ length: 120 }, (_, i) => JSON.stringify(run(String(i)))).join('\n'));
  const entries = loadTickResults(store, dir);
  assert.equal(entries.length, 100);
  assert.ok(!entries.some(entry => entry.runId === '0'));
});
