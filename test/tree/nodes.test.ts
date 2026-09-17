import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSET_FLAGS, contextFlags, countAssets, formatModified, formatTokens } from '../../src/tree/nodes';
import { Asset } from '../../src/discovery/types';
import { agent, asset, command, pluginScope, skill, systemScope, workspaceScope } from '../helpers/assets';

/**
 * The flag vocabulary every menu `when` clause in package.json is written against. These
 * assert the whole set, not a substring, because an extra flag can switch a menu on as
 * surely as a missing one switches it off.
 */

const flags = (a: Asset, editing = true): string[] => contextFlags(a, editing);

test('a user skill carries the full editable set', () => {
  assert.deepEqual(flags(skill('deploy', { toggle: { target: 'skill', key: 'deploy', file: '/s.json' } })), [
    'openable',
    'invocable',
    'togglable',
    'enabled',
    'skillVisibility',
    'fileBacked',
    'editable',
    'skill',
    'dashboardable',
    'runnable',
    'describable',
    'diagnosable',
  ]);
});

test('with editing off the write flags disappear but the read ones stay', () => {
  const s = skill('deploy', { toggle: { target: 'skill', key: 'deploy', file: '/s.json' } });
  const off = flags(s, false);
  for (const gone of ['togglable', 'enabled', 'skillVisibility', 'editable', 'describable']) {
    assert.ok(!off.includes(gone), `${gone} should need editing`);
  }
  for (const kept of ['openable', 'invocable', 'fileBacked', 'skill', 'runnable', 'diagnosable']) {
    assert.ok(off.includes(kept), `${kept} should not need editing`);
  }
});

test('togglable is immediately followed by its state, which the menus match as a pair', () => {
  const on = flags(skill('a', { toggle: { target: 'skill', key: 'a', file: '/s.json' }, enabled: true })).join(' ');
  const off = flags(skill('b', { toggle: { target: 'plugin', key: 'b', file: '/s.json' }, enabled: false })).join(' ');
  assert.match(on, /\btogglable enabled\b/);
  assert.match(off, /\btogglable disabled\b/);
});

test('a subagent is mentionable and never runnable', () => {
  const f = flags(agent('reviewer'));
  assert.ok(f.includes('mentionable'));
  assert.ok(!f.includes('runnable'));
  assert.ok(!f.includes('invocable'));
});

test('a command with a valid invocation is runnable, one without is not', () => {
  assert.ok(flags(command('deploy')).includes('runnable'));
  assert.ok(!flags(command('deploy', { invocation: 'deploy' })).includes('runnable'));
});

test('a plugin skill is not fileBacked or editable, but is still runnable', () => {
  const f = flags(skill('x', { scope: pluginScope() }));
  assert.ok(!f.includes('fileBacked'));
  assert.ok(!f.includes('editable'));
  assert.ok(f.includes('runnable'));
});

test('an MCP row is mcpServer only when it comes from a .mcp.json', () => {
  const real = asset({ kind: 'mcp', name: 'srv', sourcePath: '/proj/.mcp.json', scope: workspaceScope() });
  const stale = asset({ kind: 'mcp', name: 'srv', sourcePath: '/proj/.claude/settings.local.json', scope: workspaceScope() });
  assert.ok(flags(real).includes('mcpServer'));
  assert.ok(!flags(stale).includes('mcpServer'));
});

test('the permissions setting row is both permissions and settingEditable', () => {
  const f = flags(asset({ kind: 'setting', name: 'permissions', sourcePath: '/s.json' }));
  assert.ok(f.includes('permissions'));
  assert.ok(f.includes('settingEditable'));
});

test('a placeholder is creatable only in a user or workspace scope of a creatable kind', () => {
  assert.ok(flags(asset({ kind: 'skill', name: 'Skills', placeholder: true })).includes('creatable'));
  assert.ok(!flags(asset({ kind: 'skill', name: 'Skills', placeholder: true, scope: systemScope() })).includes('creatable'));
  assert.ok(!flags(asset({ kind: 'plan', name: 'Plans', placeholder: true })).includes('creatable'));
});

test('a placeholder is never openable, and a real row never placeholder', () => {
  assert.ok(flags(asset({ kind: 'skill', name: 'Skills', placeholder: true })).includes('placeholder'));
  assert.ok(flags(skill('a')).includes('openable'));
});

test('an overridden asset is both overridden and dashboardable', () => {
  const f = flags(
    skill('a', {
      overriddenBy: { name: '/a', scopeLabel: 'user', sourcePath: '/u/a', reason: 'r', everywhere: true },
    }),
  );
  assert.ok(f.includes('overridden'));
  assert.ok(f.includes('dashboardable'));
});

test('the skill flag stands alone, as the Diagnose menu regex requires', () => {
  // package.json matches /(^| )skill( |$)/, which must not be satisfied by skillVisibility.
  const value = flags(skill('a')).join(' ');
  assert.match(value, /(^| )skill( |$)/);
  const notASkill = flags(command('a')).join(' ');
  assert.ok(!/(^| )skill( |$)/.test(notASkill));
});

test('every flag produced across the matrix is declared in ASSET_FLAGS', () => {
  const produced = new Set<string>();
  const samples: Asset[] = [
    skill('a', { toggle: { target: 'skill', key: 'a', file: '/s.json' } }),
    command('b'),
    agent('c'),
    asset({ kind: 'setting', name: 'permissions', sourcePath: '/s.json' }),
    asset({ kind: 'mcp', name: 'm', sourcePath: '/proj/.mcp.json', scope: workspaceScope() }),
    asset({ kind: 'memory', name: 'CLAUDE.md', sourcePath: '/proj/CLAUDE.md', scope: workspaceScope() }),
    asset({ kind: 'hook', name: 'h', sourcePath: '/s.json', docs: 'https://x' }),
    asset({ kind: 'skill', name: 'Skills', placeholder: true }),
    skill('d', { overriddenBy: { name: '/d', scopeLabel: 'user', sourcePath: '/x', reason: 'r', everywhere: true } }),
    asset({ kind: 'plugin', name: 'p', scope: pluginScope(), sourcePath: '/p.json', enabled: false, toggle: { target: 'plugin', key: 'p', file: '/s.json' } }),
  ];
  for (const sample of samples) {
    for (const editing of [true, false]) {
      for (const flag of contextFlags(sample, editing)) {
        produced.add(flag);
      }
    }
  }
  for (const flag of produced) {
    assert.ok((ASSET_FLAGS as readonly string[]).includes(flag), `ASSET_FLAGS is missing ${flag}`);
  }
  // And nothing declared is dead: every entry is reachable from some sample.
  for (const declared of ASSET_FLAGS) {
    assert.ok(produced.has(declared), `${declared} is declared but unreachable`);
  }
});

test('formatTokens abbreviates only from a thousand', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1.0k');
  assert.equal(formatTokens(10_000), '10k');
});

test('formatModified appends a relative hint', () => {
  assert.match(formatModified(Date.now()), /\(today\)$/);
  assert.match(formatModified(Date.now() - 86_400_000), /\(yesterday\)$/);
  assert.match(formatModified(Date.now() - 3 * 86_400_000), /\(3 days ago\)$/);
});

test('countAssets counts recursively', () => {
  assert.equal(countAssets([]), 0);
});
