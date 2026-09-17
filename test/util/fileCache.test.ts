import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { beforeEach, test } from 'node:test';
import { beginScan, clearFileCache, endScan, readText } from '../../src/util/fs';
import { useFixture } from '../helpers/fixture';

/**
 * File contents are kept between scans and revalidated by timestamp and size. The whole risk
 * of that is serving something stale, so these tests are mostly about when the cache must
 * NOT be used.
 *
 * Timestamps are set explicitly rather than slept for: a file modified in the last second is
 * deliberately never served from cache, so a test that just wrote a file would otherwise be
 * measuring the freshness guard instead of the cache.
 */

/** Backdate a file so it counts as settled, and control its timestamp exactly. */
function backdate(file: string, secondsAgo: number): void {
  const when = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(file, when, when);
}

/**
 * Count real reads while running `body`. The bundle is CommonJS, so `require('fs')` hands back
 * the same mutable module object the code under test calls through — an ESM import binding
 * cannot be assigned to.
 */
const mutableFs = require('fs') as { readFileSync: typeof fs.readFileSync };

function countReads(body: () => void): number {
  const original = mutableFs.readFileSync;
  let reads = 0;
  mutableFs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    reads += 1;
    return original(...args);
  }) as typeof fs.readFileSync;
  try {
    body();
  } finally {
    mutableFs.readFileSync = original;
  }
  return reads;
}

beforeEach(() => clearFileCache());

test('an unchanged file is read once and then served from the cache', (t) => {
  const fx = useFixture(t, { 'a.md': 'hello' });
  const file = fx.path('a.md');
  backdate(file, 60);

  const first = countReads(() => assert.equal(readText(file), 'hello'));
  const second = countReads(() => assert.equal(readText(file), 'hello'));

  assert.equal(first, 1, 'the first read must reach the disk');
  assert.equal(second, 0, 'the second must not');
});

test('a file modified within the last second is always re-read', (t) => {
  // The guard against a second write landing before the timestamp can distinguish it.
  const fx = useFixture(t, { 'a.md': 'hello' });
  const file = fx.path('a.md');

  readText(file);
  const again = countReads(() => readText(file));
  assert.equal(again, 1, 'a just-written file must not be trusted');
});

test('a changed file is re-read even when its size is identical', (t) => {
  // Size alone would miss this; the timestamp is what catches it.
  const fx = useFixture(t, { 'a.md': 'aaaaa' });
  const file = fx.path('a.md');
  backdate(file, 60);
  assert.equal(readText(file), 'aaaaa');

  fs.writeFileSync(file, 'bbbbb');
  backdate(file, 30);
  assert.equal(readText(file), 'bbbbb');
});

test('a file that grows is re-read even if something preserved its timestamp', (t) => {
  // The mirror case: an archive extraction or a copy can restore the old mtime.
  const fx = useFixture(t, { 'a.md': 'short' });
  const file = fx.path('a.md');
  backdate(file, 60);
  assert.equal(readText(file), 'short');

  const stats = fs.statSync(file);
  fs.writeFileSync(file, 'much longer content');
  fs.utimesSync(file, stats.atime, stats.mtime);
  assert.equal(readText(file), 'much longer content');
});

test('a deleted file stops being served', (t) => {
  const fx = useFixture(t, { 'a.md': 'hello' });
  const file = fx.path('a.md');
  backdate(file, 60);
  assert.equal(readText(file), 'hello');

  fs.rmSync(file);
  assert.equal(readText(file), undefined);
});

test('a file recreated after deletion is read fresh', (t) => {
  const fx = useFixture(t, { 'a.md': 'first' });
  const file = fx.path('a.md');
  backdate(file, 60);
  assert.equal(readText(file), 'first');

  fs.rmSync(file);
  assert.equal(readText(file), undefined);
  fs.writeFileSync(file, 'second');
  backdate(file, 30);
  assert.equal(readText(file), 'second');
});

test('a directory and a missing path both read as undefined', (t) => {
  const fx = useFixture(t, { dir: { 'x.md': 'x' } });
  assert.equal(readText(fx.path('dir')), undefined);
  assert.equal(readText(fx.path('nope.md')), undefined);
});

test('clearFileCache forces the next read back to the disk', (t) => {
  const fx = useFixture(t, { 'a.md': 'hello' });
  const file = fx.path('a.md');
  backdate(file, 60);
  readText(file);
  assert.equal(countReads(() => readText(file)), 0);

  clearFileCache();
  assert.equal(countReads(() => readText(file)), 1);
});

test('within one scan the same file is read once even when it is not settled', (t) => {
  const fx = useFixture(t, { 'a.md': 'hello' });
  const file = fx.path('a.md');
  // No backdating: the per-scan memo covers a file too fresh for the cross-scan cache.
  beginScan();
  try {
    const reads = countReads(() => {
      readText(file);
      readText(file);
      readText(file);
    });
    assert.equal(reads, 1);
  } finally {
    endScan();
  }
});

test('a file over the per-file limit is served correctly but not retained', (t) => {
  const big = 'x'.repeat(300_000);
  const fx = useFixture(t, { 'big.md': big });
  const file = fx.path('big.md');
  backdate(file, 60);

  assert.equal(readText(file)?.length, big.length);
  assert.equal(countReads(() => readText(file)), 1, 'too large to keep, so it is read again');
});
