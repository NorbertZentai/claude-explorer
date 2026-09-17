import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { evaluate, MatchContext, parseToolCall, RuleInput, ruleMatches, splitCompound } from '../../src/analysis/permissionMatch';

/**
 * What Claude Code is allowed to do. A wrong answer here misleads the user about their own
 * safety settings, so the order (deny, then ask, then allow) and the compound-command rule
 * are pinned exactly. The context is injected, so nothing here reads the real home directory.
 */

const ctx: MatchContext = {
  cwd: path.join(path.sep, 'proj'),
  userClaudeDir: path.join(path.sep, 'home', 'u', '.claude'),
  home: path.join(path.sep, 'home', 'u'),
};

const rule = (list: RuleInput['list'], text: string, sourceLabel = 'user settings'): RuleInput => ({
  list,
  rule: text,
  sourceLabel,
  sourcePath: '/home/u/.claude/settings.json',
});

test('parseToolCall splits a tool from its argument', () => {
  assert.deepEqual(parseToolCall('Bash(npm test)'), { tool: 'Bash', arg: 'npm test' });
});

test('parseToolCall distinguishes a bare tool from an empty argument', () => {
  assert.deepEqual(parseToolCall('Bash'), { tool: 'Bash', arg: undefined });
  assert.deepEqual(parseToolCall('Bash()'), { tool: 'Bash', arg: '' });
});

test('parseToolCall tolerates surrounding whitespace and accepts mcp names', () => {
  assert.deepEqual(parseToolCall('  Read(a.ts) '), { tool: 'Read', arg: 'a.ts' });
  assert.equal(parseToolCall('mcp__github__create_issue')?.tool, 'mcp__github__create_issue');
});

test('parseToolCall returns undefined for junk', () => {
  assert.equal(parseToolCall(''), undefined);
  assert.equal(parseToolCall('Bash(unclosed'), undefined);
});

test('splitCompound splits on every shell separator', () => {
  assert.deepEqual(splitCompound('a && b'), ['a', 'b']);
  assert.deepEqual(splitCompound('a || b'), ['a', 'b']);
  assert.deepEqual(splitCompound('a ; b'), ['a', 'b']);
  assert.deepEqual(splitCompound('a | b'), ['a', 'b']);
  assert.deepEqual(splitCompound('a\nb'), ['a', 'b']);
});

test('splitCompound does not split inside quotes', () => {
  assert.deepEqual(splitCompound('echo "a && b"'), ['echo "a && b"']);
  assert.deepEqual(splitCompound("echo 'a ; b'"), ["echo 'a ; b'"]);
});

test('splitCompound drops empty parts and trims', () => {
  assert.deepEqual(splitCompound('a &&  && b'), ['a', 'b']);
});

test('splitCompound returns nothing for an empty command', () => {
  assert.deepEqual(splitCompound(''), []);
});

test('deny beats ask, and ask beats allow', () => {
  const rules = [rule('allow', 'Bash(npm test)'), rule('ask', 'Bash(npm test)'), rule('deny', 'Bash(npm test)')];
  assert.equal(evaluate('Bash(npm test)', rules, ctx).decision, 'deny');
  assert.equal(evaluate('Bash(npm test)', rules.slice(0, 2), ctx).decision, 'ask');
  assert.equal(evaluate('Bash(npm test)', rules.slice(0, 1), ctx).decision, 'allow');
});

test('a compound command is denied when any single part is', () => {
  const result = evaluate('Bash(npm test && rm -rf /)', [rule('deny', 'Bash(rm -rf /)')], ctx);
  assert.equal(result.decision, 'deny');
  assert.match(result.explanation, /for the part "rm -rf \/"/);
});

test('a compound command is allowed only when every part is', () => {
  const rules = [rule('allow', 'Bash(npm test)')];
  assert.equal(evaluate('Bash(npm test)', rules, ctx).decision, 'allow');
  const partial = evaluate('Bash(npm test && npm publish)', rules, ctx);
  assert.equal(partial.decision, 'none');
  assert.match(partial.explanation, /not covered by any allow rule/);
});

test('a Read deny also stops an edit of the same path, and says which rule did it', () => {
  const result = evaluate('Write(.env)', [rule('deny', 'Read(.env)')], ctx);
  assert.equal(result.decision, 'deny');
  assert.match(result.explanation, /Read\(\.env\)/);
});

test('a Read rule governs Grep and Glob as well', () => {
  assert.ok(ruleMatches(rule('deny', 'Read(.env)'), { tool: 'Grep', arg: '.env' }, ctx));
  assert.ok(ruleMatches(rule('deny', 'Read(.env)'), { tool: 'Glob', arg: '.env' }, ctx));
});

test('Bash(*) matches everything, but a bare Tool(*) does not', () => {
  assert.ok(ruleMatches(rule('allow', 'Bash(*)'), { tool: 'Bash', arg: 'anything at all' }, ctx));
  assert.ok(!ruleMatches(rule('allow', 'Read(*)'), { tool: 'Read', arg: '/etc/passwd' }, ctx));
});

test('a tool glob only counts on the allow list after a literal mcp__server__ prefix', () => {
  assert.ok(!ruleMatches(rule('allow', 'mcp__*'), { tool: 'mcp__github__x', arg: undefined }, ctx));
  assert.ok(ruleMatches(rule('deny', 'mcp__*'), { tool: 'mcp__github__x', arg: undefined }, ctx));
  assert.ok(ruleMatches(rule('allow', 'mcp__github__*'), { tool: 'mcp__github__x', arg: undefined }, ctx));
});

test('an mcp rule written with parentheses never matches, as Claude Code skips it', () => {
  assert.ok(!ruleMatches(rule('allow', 'mcp__github__create(x)'), { tool: 'mcp__github__create', arg: 'x' }, ctx));
});

test('a Tool(param:value) rule is skipped, except WebFetch(domain:…)', () => {
  assert.ok(!ruleMatches(rule('allow', 'Write(file_path:/x)'), { tool: 'Write', arg: '/x' }, ctx));
  assert.ok(ruleMatches(rule('allow', 'WebFetch(domain:example.com)'), { tool: 'WebFetch', arg: 'https://example.com/p' }, ctx));
});

test('a rule with no argument matches every call to that tool', () => {
  assert.ok(ruleMatches(rule('deny', 'WebFetch'), { tool: 'WebFetch', arg: 'https://x' }, ctx));
});

test('an unparseable call is explained rather than decided', () => {
  const result = evaluate('', [], ctx);
  assert.equal(result.decision, 'none');
  assert.match(result.explanation, /Tool\(argument\)/);
});

test('Bash matching is case-sensitive; PowerShell is not', () => {
  assert.ok(!ruleMatches(rule('allow', 'Bash(npm test)'), { tool: 'Bash', arg: 'NPM test' }, ctx));
  assert.ok(ruleMatches(rule('allow', 'PowerShell(Get-ChildItem)'), { tool: 'PowerShell', arg: 'get-childitem' }, ctx));
});
