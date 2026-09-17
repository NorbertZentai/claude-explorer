import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  filesWithExtension,
  findLine,
  isDir,
  isFile,
  isUnparsableJson,
  mtime,
  readJson,
  readText,
  subdirs,
} from '../../src/util/fs';
import { useFixture } from '../helpers/fixture';

/**
 * The robustness invariant: a missing directory is the normal case, and a hand-edited file of
 * the wrong shape must be skipped rather than thrown on. Nothing here may throw.
 */

test('nothing throws on a path that is not there', (t) => {
  const fx = useFixture(t, {});
  const gone = fx.path('nope', 'deeper');
  assert.equal(isDir(gone), false);
  assert.equal(isFile(gone), false);
  assert.equal(mtime(gone), undefined);
  assert.equal(readText(gone), undefined);
  assert.equal(readJson(gone), undefined);
  assert.deepEqual(subdirs(gone), []);
  assert.deepEqual(filesWithExtension(gone, '.md'), []);
});

test('isDir and isFile tell the two apart', (t) => {
  const fx = useFixture(t, { dir: { 'a.md': 'x' } });
  assert.equal(isDir(fx.path('dir')), true);
  assert.equal(isFile(fx.path('dir')), false);
  assert.equal(isFile(fx.path('dir', 'a.md')), true);
  assert.equal(isDir(fx.path('dir', 'a.md')), false);
});

test('mtime returns a plausible timestamp', (t) => {
  const fx = useFixture(t, { 'a.md': 'x' });
  const when = mtime(fx.path('a.md'));
  assert.ok(when !== undefined);
  assert.ok(Math.abs(Date.now() - when) < 60_000);
});

test('readJson strips a BOM before parsing', (t) => {
  // Notepad and PowerShell redirection both write one, and it used to make the extension
  // call valid settings malformed and report "not signed in" while signed in.
  const fx = useFixture(t, { 'a.json': '﻿{"model":"opus"}' });
  assert.deepEqual(readJson(fx.path('a.json')), { model: 'opus' });
});

test('readJson strips line and block comments', (t) => {
  const fx = useFixture(t, {
    'a.json': '{\n  // why\n  "a": 1,\n  /* block\n     spanning */\n  "b": 2\n}',
  });
  assert.deepEqual(readJson(fx.path('a.json')), { a: 1, b: 2 });
});

test('readJson does not mistake a // inside a string for a comment', (t) => {
  // The single most important case in the comment stripper.
  const fx = useFixture(t, { 'a.json': '{"url":"https://example.com/x"}' });
  assert.deepEqual(readJson(fx.path('a.json')), { url: 'https://example.com/x' });
});

test('readJson survives an escaped quote inside a string', (t) => {
  const fx = useFixture(t, { 'a.json': '{"a":"say \\"hi\\" // not a comment"}' });
  assert.deepEqual(readJson(fx.path('a.json')), { a: 'say "hi" // not a comment' });
});

test('readJson returns undefined for a trailing comma rather than throwing', (t) => {
  const fx = useFixture(t, { 'a.json': '{"a":1,}' });
  assert.equal(readJson(fx.path('a.json')), undefined);
});

test('isUnparsableJson tells broken apart from absent', (t) => {
  const fx = useFixture(t, { 'broken.json': '{', 'good.json': '{}' });
  assert.equal(isUnparsableJson(fx.path('broken.json')), true);
  assert.equal(isUnparsableJson(fx.path('good.json')), false);
  assert.equal(isUnparsableJson(fx.path('missing.json')), false);
});

test('subdirs is sorted and skips bookkeeping directories', (t) => {
  const fx = useFixture(t, {
    root: {
      zeta: { 'k': '' },
      alpha: { 'k': '' },
      '.git': { 'k': '' },
      node_modules: { 'k': '' },
      __pycache__: { 'k': '' },
      '.in_use': { 'k': '' },
      'a-file.md': 'x',
    },
  });
  assert.deepEqual(subdirs(fx.path('root')), ['alpha', 'zeta']);
});

test('filesWithExtension matches case-insensitively and returns sorted absolute paths', (t) => {
  const fx = useFixture(t, { d: { 'b.MD': 'x', 'a.md': 'x', 'c.txt': 'x', sub: { 'z.md': 'x' } } });
  assert.deepEqual(filesWithExtension(fx.path('d'), '.md'), [fx.path('d', 'a.md'), fx.path('d', 'b.MD')]);
});

test('filesWithExtension with an empty extension returns every file', (t) => {
  const fx = useFixture(t, { d: { 'a.md': 'x', 'b.txt': 'x', sub: {} } });
  assert.deepEqual(filesWithExtension(fx.path('d'), ''), [fx.path('d', 'a.md'), fx.path('d', 'b.txt')]);
});

test('findLine reports a 0-based index, and undefined when there is no match', () => {
  assert.equal(findLine('one\ntwo\nthree', 'two'), 1);
  assert.equal(findLine('one\r\ntwo', 'two'), 1);
  assert.equal(findLine('one\ntwo', 'nope'), undefined);
  assert.equal(findLine(undefined, 'two'), undefined);
});

test('a path built with the platform separator behaves the same', (t) => {
  const fx = useFixture(t, { a: { b: { 'c.md': 'x' } } });
  assert.equal(isFile([fx.dir, 'a', 'b', 'c.md'].join(path.sep)), true);
});
