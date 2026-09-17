import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeCommandLine, INVOCATION, oneLine, shellQuote } from '../../src/util/shell';

/**
 * The quoting boundary between configuration text and a real shell, and the gate that decides
 * what a keybinding is allowed to send. Both platforms are exercised explicitly through the
 * `platform` parameter, so the result does not depend on where the suite runs.
 */

test('shellQuote escapes a single quote per platform', () => {
  assert.equal(shellQuote("it's", 'linux'), `'it'\\''s'`);
  assert.equal(shellQuote("it's", 'win32'), `'it''s'`);
});

test('shellQuote wraps an empty string', () => {
  assert.equal(shellQuote('', 'linux'), `''`);
  assert.equal(shellQuote('', 'win32'), `''`);
});

test('shellQuote leaves shell metacharacters literal inside the quotes', () => {
  for (const meta of ['$HOME', '`id`', 'a;b', 'a&&b', 'a|b', 'a>b', 'a\nb', '$(id)', '*', '~']) {
    assert.equal(shellQuote(meta, 'linux'), `'${meta}'`, meta);
    assert.equal(shellQuote(meta, 'win32'), `'${meta}'`, meta);
  }
});

test('INVOCATION accepts the shapes Claude Code names', () => {
  for (const ok of ['/deploy', '/plugin:skill', '/a_b', '/a.b', '/a-b', '/0start', '/A', '/x:y:z']) {
    assert.ok(INVOCATION.test(ok), ok);
  }
});

test('INVOCATION rejects anything that is not just a slash command', () => {
  // This table is the injection gate for keybinding arguments and tree rows.
  for (const bad of [
    'deploy',
    '/',
    '/-start',
    '/.start',
    '/a b',
    '/a;rm -rf /',
    '/a\nb',
    '//a',
    '/a$(id)',
    "/a'b",
    '/a|b',
    '/a&&b',
    ' /a',
    '/a ',
    '/a"b',
    '',
  ]) {
    assert.ok(!INVOCATION.test(bad), `should be rejected: ${JSON.stringify(bad)}`);
  }
});

test('oneLine folds a multi-line prompt and trims', () => {
  assert.equal(oneLine('  first\n\n  second  \n third '), 'first second third');
});

test('oneLine handles CRLF', () => {
  assert.equal(oneLine('a\r\nb'), 'a b');
});

test('oneLine returns an empty string for whitespace only', () => {
  assert.equal(oneLine('  \n\t '), '');
});

test('claudeCommandLine folds and quotes in one step', () => {
  assert.equal(claudeCommandLine('/deploy', 'linux'), `claude '/deploy'`);
  assert.equal(claudeCommandLine("say 'hi'\nnow", 'linux'), `claude 'say '\\''hi'\\''  now'`.replace('  ', ' '));
  assert.equal(claudeCommandLine("say 'hi'", 'win32'), `claude 'say ''hi'''`);
});

test('claudeCommandLine cannot be broken out of with a newline', () => {
  const line = claudeCommandLine('/deploy\nrm -rf /', 'linux');
  assert.ok(!line.includes('\n'));
  assert.equal(line, `claude '/deploy rm -rf /'`);
});
