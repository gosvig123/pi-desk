'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ReviewStore } = require('../bin/review-store');

function file(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-reviewed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'review.json');
}

test('review marks survive reopening; retention keeps at most 2000 recent marks', t => {
  const target = file(t);
  const store = new ReviewStore(target);
  assert.equal(store.has('tick:a:one'), false);
  store.mark(['tick:a:one'], new Date('2026-09-12T10:00:00Z'));
  assert.equal(new ReviewStore(target).has('tick:a:one'), true);
  store.mark(Array.from({ length: 2100 }, (_, i) => `tick:a:${i}`), new Date('2027-06-01T00:00:00Z'));
  assert.equal(Object.keys(store.reviewed).length, 2000);
  assert.equal(store.has('tick:a:one'), false);
  assert.equal(Object.keys(new ReviewStore(target).reviewed).length, 2000);
});

test('failed writes do not mark an item reviewed in memory or overwrite stored marks', t => {
  const target = file(t);
  const store = new ReviewStore(target);
  store.mark(['tick:a:one']);
  const previous = fs.readFileSync(target, 'utf8');
  fs.mkdirSync(`${target}.tmp`);
  assert.throws(() => store.mark(['tick:a:two']), /review status not saved/);
  assert.equal(store.has('tick:a:two'), false);
  assert.equal(store.has('tick:a:one'), true);
  assert.equal(fs.readFileSync(target, 'utf8'), previous);
});
