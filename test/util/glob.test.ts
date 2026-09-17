import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeRegExp, globToRegExp, matchesPathGlob } from '../../src/util/glob';

/** Gitignore-flavoured globbing, used by claudeMdExcludes, permission paths and tool names. */

test('* stays within one segment when slash-aware', () => {
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/nested/a.ts'));
});

test('** crosses slashes', () => {
  assert.ok(globToRegExp('src/**').test('src/nested/deep/a.ts'));
  assert.ok(globToRegExp('**/CLAUDE.md').test('a/b/CLAUDE.md'));
});

test('**/ may match zero directories', () => {
  assert.ok(globToRegExp('**/a.md').test('a.md'));
});

test('? matches exactly one non-slash character', () => {
  assert.ok(globToRegExp('a?c').test('abc'));
  assert.ok(!globToRegExp('a?c').test('ac'));
  assert.ok(!globToRegExp('a?c').test('a/c'));
});

test('{a,b} alternates', () => {
  const re = globToRegExp('*.{ts,js}');
  assert.ok(re.test('a.ts'));
  assert.ok(re.test('a.js'));
  assert.ok(!re.test('a.md'));
});

test('braces do not nest: the first } closes the group', () => {
  // `indexOf('}')` finds the inner brace, so `{a,{b,c}}` becomes `(?:a|\{b|c)\}`.
  // Documented rather than fixed: no pattern in this codebase nests them.
  assert.ok(!globToRegExp('{a,{b,c}}.md').test('c.md'));
  assert.ok(globToRegExp('{a,{b,c}}.md').test('c}.md'));
});

test('an unclosed { is literal', () => {
  assert.ok(globToRegExp('a{b.md').test('a{b.md'));
});

test('regex metacharacters in the glob are escaped', () => {
  assert.ok(globToRegExp('a.b').test('a.b'));
  assert.ok(!globToRegExp('a.b').test('axb'));
  assert.ok(globToRegExp('a+b').test('a+b'));
  assert.ok(globToRegExp('a(b)').test('a(b)'));
});

test('the pattern is anchored at both ends', () => {
  assert.ok(!globToRegExp('a').test('ab'));
  assert.ok(!globToRegExp('b').test('ab'));
});

test('slashAware false lets * and ? cross slashes, for tool-name globs', () => {
  assert.ok(globToRegExp('mcp__*', false).test('mcp__github__create_issue'));
  assert.ok(!globToRegExp('mcp__*', true).test('mcp__a/b'));
});

test('escapeRegExp escapes every metacharacter it claims to', () => {
  assert.equal(escapeRegExp('.*+?^${}()|[]\\'), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
});

test('matchesPathGlob normalises backslashes on both sides', () => {
  assert.ok(matchesPathGlob('C:/proj/**', 'C:\\proj\\CLAUDE.md'));
  assert.ok(matchesPathGlob('C:\\proj\\**', 'C:/proj/CLAUDE.md'));
});

test('the claudeMdExcludes shapes behave as documented', () => {
  assert.ok(matchesPathGlob('**/CLAUDE.md', '/repo/pkg/CLAUDE.md'));
  assert.ok(!matchesPathGlob('*/CLAUDE.md', '/repo/pkg/deep/CLAUDE.md'));
  assert.ok(matchesPathGlob('/repo/CLAUDE.md', '/repo/CLAUDE.md'));
});
