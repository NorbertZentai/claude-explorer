import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collect } from '../../src/discovery';
import { Asset, AssetKind } from '../../src/discovery/types';
import { md, useFixture } from '../helpers/fixture';

/**
 * Discovery end to end, on a fixture holding one of nearly everything. This is the test that
 * pins what the tree contains, so any change to how the filesystem is read -- caching, fewer
 * syscalls, going async -- has to keep producing exactly this.
 */

const TREE = {
  '.claude': {
    'settings.json': JSON.stringify(
      {
        model: 'opus',
        outputStyle: 'concise',
        permissions: { allow: ['Bash(npm test)'], deny: ['Read(./.env)'] },
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
        },
      },
      null,
      2,
    ),
    'CLAUDE.md': '# User memory\n\nAlways answer in English.\n',
    skills: {
      deploy: { 'SKILL.md': md({ name: 'deploy', description: 'Ship the app.' }) },
      'no-description': { 'SKILL.md': md({ name: 'no-description' }, 'A body line.\n') },
      'not-a-skill': { 'README.md': 'no SKILL.md here' },
    },
    commands: { 'review.md': md({ description: 'Review a PR.' }), 'bare.md': 'Just prose.\n' },
    agents: { 'reviewer.md': md({ name: 'reviewer', description: 'Use when reviewing.' }) },
    rules: { 'style.md': md({ description: 'House style.' }) },
    'output-styles': { 'terse.md': md({ description: 'Short answers.' }) },
  },
  proj: {
    '.claude': {
      'settings.json': JSON.stringify({ model: 'sonnet' }, null, 2),
      'settings.local.json': JSON.stringify({ enabledMcpjsonServers: ['local'] }, null, 2),
      skills: { deploy: { 'SKILL.md': md({ name: 'deploy', description: 'Project deploy.' }) } },
      commands: { 'build.md': md({ description: 'Build it.' }) },
    },
    '.mcp.json': JSON.stringify({ mcpServers: { local: { command: 'npx', args: ['server'] } } }, null, 2),
    'CLAUDE.md': '# Project\n\nUse pnpm.\n',
  },
};

function scan(t: Parameters<typeof useFixture>[0]) {
  const fx = useFixture(t, TREE);
  const collection = collect({
    workspaceFolders: [fx.path('proj')],
    extraProjectPaths: [],
    showPluginProvided: true,
    showPlaceholders: true,
  });
  const real = collection.assets.filter((a) => !a.placeholder);
  const of = (kind: AssetKind, scopeKind?: string): Asset[] =>
    real.filter((a) => a.kind === kind && (scopeKind === undefined || a.scope.kind === scopeKind));
  return { fx, ...collection, real, of };
}

test('the scopes are the user directory and the opened project', (t) => {
  const { scopes, fx } = scan(t);
  const kinds = scopes.map((s) => s.kind);
  assert.ok(kinds.includes('user'));
  assert.ok(kinds.includes('workspace'));
  const workspace = scopes.find((s) => s.kind === 'workspace');
  // realPath, not the raw temp path: on Windows the fixture lives under an 8.3 short name.
  assert.equal(workspace?.root, fx.path('proj'));
  assert.equal(workspace?.hasConfigDir, true);
});

test('skills, commands and subagents are found in both scopes', (t) => {
  const { of } = scan(t);
  assert.deepEqual(of('skill', 'user').map((a) => a.name).sort(), ['deploy', 'no-description']);
  assert.deepEqual(of('skill', 'workspace').map((a) => a.name), ['deploy']);
  assert.deepEqual(of('command', 'user').map((a) => a.name).sort(), ['bare', 'review']);
  assert.deepEqual(of('command', 'workspace').map((a) => a.name), ['build']);
  assert.deepEqual(of('agent', 'user').map((a) => a.name), ['reviewer']);
});

test('a directory without SKILL.md is not a skill', (t) => {
  const { real } = scan(t);
  assert.equal(real.find((a) => a.name === 'not-a-skill'), undefined);
});

test('skills and commands get a slash invocation, subagents do not', (t) => {
  const { of } = scan(t);
  assert.equal(of('skill', 'user').find((a) => a.name === 'deploy')?.invocation, '/deploy');
  assert.equal(of('command', 'user').find((a) => a.name === 'review')?.invocation, '/review');
  assert.equal(of('agent', 'user')[0]?.invocation, undefined);
});

test('a skill with no description falls back to its first body line, without a problem', (t) => {
  const { of } = scan(t);
  const fallback = of('skill', 'user').find((a) => a.name === 'no-description');
  assert.equal(fallback?.description, 'A body line.');
  assert.equal(fallback?.problem, undefined);
});

test('a command with no frontmatter still gets a description', (t) => {
  const { of } = scan(t);
  assert.equal(of('command', 'user').find((a) => a.name === 'bare')?.description, 'Just prose.');
});

test('hooks are discovered from the settings file, one row per handler', (t) => {
  const { of } = scan(t);
  const hooks = of('hook', 'user');
  assert.equal(hooks.length, 2);
  assert.deepEqual(hooks.map((h) => h.hook?.event).sort(), ['PreToolUse', 'Stop']);
  assert.equal(hooks.find((h) => h.hook?.event === 'PreToolUse')?.hook?.matcher, 'Bash');
  assert.equal(hooks.find((h) => h.hook?.event === 'Stop')?.hook?.matcher, undefined);
});

test('the project MCP server is found and counts as approved', (t) => {
  const { of } = scan(t);
  const mcp = of('mcp', 'workspace');
  assert.equal(mcp.length, 1);
  assert.equal(mcp[0].name, 'local');
  assert.equal(mcp[0].problem, undefined, 'it is listed in enabledMcpjsonServers');
});

test('memory files are found in both scopes', (t) => {
  const { of } = scan(t);
  assert.equal(of('memory', 'user').length, 1);
  assert.equal(of('memory', 'workspace').length, 1);
});

test('the project skill shadows the user skill of the same name', (t) => {
  const { of } = scan(t);
  // applyOverrides runs inside collect(), so the tree already knows.
  const user = of('skill', 'user').find((a) => a.name === 'deploy');
  const project = of('skill', 'workspace').find((a) => a.name === 'deploy');
  assert.equal(project?.overriddenBy?.scopeLabel, 'user', 'user skills win over project ones');
  assert.equal(user?.overriddenBy, undefined);
});

test('every real asset carries a modification time', (t) => {
  const { real } = scan(t);
  const missing = real.filter((a) => a.modified === undefined).map((a) => `${a.kind}/${a.name}`);
  assert.deepEqual(missing, []);
});

test('placeholders appear only for surfaces with nothing in them, and only when asked', (t) => {
  const fx = useFixture(t, TREE);
  const options = { workspaceFolders: [fx.path('proj')], extraProjectPaths: [] as string[], showPluginProvided: true };
  const withGhosts = collect({ ...options, showPlaceholders: true });
  const without = collect({ ...options, showPlaceholders: false });
  assert.equal(without.assets.filter((a) => a.placeholder).length, 0);

  const ghostKinds = new Set(withGhosts.assets.filter((a) => a.placeholder && a.scope.kind === 'user').map((a) => a.kind));
  assert.ok(!ghostKinds.has('skill'), 'the user has skills, so there is no skill placeholder');
  assert.ok(ghostKinds.has('workflow'), 'the user has no workflows, so there should be one');
});

/**
 * The shape the tree renders, as one value. Any change to how discovery reads the disk has to
 * leave this identical -- that is the point of having it.
 */
test('the full scan produces a stable inventory', (t) => {
  const { real } = scan(t);
  const inventory: Record<string, number> = {};
  for (const a of real) {
    const key = `${a.scope.kind}/${a.kind}`;
    inventory[key] = (inventory[key] ?? 0) + 1;
  }
  assert.deepEqual(inventory, {
    'user/setting': 4,
    'user/memory': 1,
    'user/skill': 2,
    'user/command': 2,
    'user/agent': 1,
    'user/rule': 1,
    'user/outputStyle': 1,
    'user/hook': 2,
    'workspace/setting': 3,
    'workspace/memory': 1,
    'workspace/skill': 1,
    'workspace/command': 1,
    'workspace/mcp': 1,
  });
});

test('a second scan sees changes made since the first', (t) => {
  // collect() memoises its reads for the duration of one pass. If that snapshot ever
  // outlived the pass, the tree would silently stop updating -- the worst failure this
  // extension could have, and an invisible one.
  const fx = useFixture(t, TREE);
  const options = {
    workspaceFolders: [fx.path('proj')],
    extraProjectPaths: [] as string[],
    showPluginProvided: true,
    showPlaceholders: false,
  };
  const before = collect(options);
  assert.equal(before.assets.filter((a) => a.kind === 'skill' && a.scope.kind === 'user').length, 2);

  fx.write('.claude/skills/added-later/SKILL.md', md({ name: 'added-later', description: 'New.' }));
  const after = collect(options);
  const names = after.assets
    .filter((a) => a.kind === 'skill' && a.scope.kind === 'user')
    .map((a) => a.name)
    .sort();
  assert.deepEqual(names, ['added-later', 'deploy', 'no-description']);
});

test('a file edited between scans is re-read, not served from the previous snapshot', (t) => {
  const fx = useFixture(t, TREE);
  const options = {
    workspaceFolders: [fx.path('proj')],
    extraProjectPaths: [] as string[],
    showPluginProvided: true,
    showPlaceholders: false,
  };
  collect(options);
  fx.write('.claude/skills/deploy/SKILL.md', md({ name: 'deploy', description: 'Changed description.' }));
  const after = collect(options);
  const deploy = after.assets.find((a) => a.kind === 'skill' && a.scope.kind === 'user' && a.name === 'deploy');
  assert.equal(deploy?.description, 'Changed description.');
});
