import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { ASSET_FLAGS } from '../src/tree/nodes';
import { ASSET_ORDER } from '../src/discovery/types';

/**
 * package.json and the source have to agree, and nothing else checks that. A menu entry
 * naming a command that does not exist, or a `when` clause matching a flag the code never
 * produces, is invisible until someone right-clicks the row and nothing happens.
 */

/** Walk up from the bundle to the repo root, so the depth of a test file does not matter. */
function repoRoot(from: string): string {
  let dir = from;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) {
      throw new Error('could not find the repo root above ' + from);
    }
    dir = up;
  }
  return dir;
}

const root = repoRoot(__dirname);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    submenus?: Array<{ id: string }>;
    menus: Record<string, Array<{ command?: string; submenu?: string; when?: string; group?: string }>>;
    configuration?: { properties: Record<string, unknown> };
  };
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(full) : e.name.endsWith('.ts') ? [full] : [];
  });
}

const sources = sourceFiles(path.join(root, 'src'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

/** Both registration shapes used here: vscode.commands.registerCommand and the local helper. */
const registered = new Set(
  [...sources.matchAll(/(?:registerCommand|command)\(\s*'(claudeExplorer\.[\w.]+)'/g)].map((m) => m[1]),
);
const declared = new Set(manifest.contributes.commands.map((c) => c.command));
const menus = manifest.contributes.menus;
const allEntries = Object.values(menus).flat();

test('every declared command is registered in the source', () => {
  const missing = [...declared].filter((id) => !registered.has(id));
  assert.deepEqual(missing, [], `declared in package.json but never registered: ${missing.join(', ')}`);
});

test('every registered command is declared in package.json', () => {
  const undeclared = [...registered].filter((id) => !declared.has(id));
  assert.deepEqual(undeclared, [], `registered but not contributed: ${undeclared.join(', ')}`);
});

test('every menu entry names a declared command or submenu', () => {
  const submenus = new Set((manifest.contributes.submenus ?? []).map((s) => s.id));
  for (const [menu, entries] of Object.entries(menus)) {
    for (const entry of entries) {
      if (entry.command) {
        assert.ok(declared.has(entry.command), `${menu}: ${entry.command} is not in contributes.commands`);
      }
      if (entry.submenu) {
        assert.ok(submenus.has(entry.submenu), `${menu}: ${entry.submenu} is not in contributes.submenus`);
      }
    }
  }
});

test('every declared submenu is mounted somewhere and has at least one entry', () => {
  for (const submenu of manifest.contributes.submenus ?? []) {
    assert.ok(
      allEntries.some((e) => e.submenu === submenu.id),
      `${submenu.id} is declared but never mounted in a menu`,
    );
    assert.ok(
      (menus[submenu.id] ?? []).length > 0,
      `${submenu.id} is mounted but has no entries`,
    );
  }
});

/**
 * The identifiers a `viewItem =~ /…/` clause tests for. Alternations are expanded first, so
 * `kind-(setting|policy)` yields the two whole flags rather than the fragment `kind-`.
 */
function flagsIn(when: string): string[] {
  const out: string[] = [];
  for (const m of when.matchAll(/viewItem =~ \/([^/]+)\//g)) {
    let variants = [m[1].replace(/\\b|\^|\$/g, ' ')];
    // Expand one group at a time until none are left.
    for (let guard = 0; guard < 10; guard += 1) {
      const next: string[] = [];
      let expanded = false;
      for (const variant of variants) {
        const group = /\((?:\?:)?([^()]*)\)/.exec(variant);
        if (!group) {
          next.push(variant);
          continue;
        }
        expanded = true;
        for (const alternative of group[1].split('|')) {
          next.push(variant.slice(0, group.index) + alternative + variant.slice(group.index + group[0].length));
        }
      }
      variants = next;
      if (!expanded) {
        break;
      }
    }
    for (const variant of variants) {
      for (const token of variant.matchAll(/[A-Za-z][A-Za-z0-9-]*/g)) {
        out.push(token[0]);
      }
    }
  }
  return out;
}

test('every flag a when-clause tests for is one the code can produce', () => {
  const producible = new Set<string>([
    ...ASSET_FLAGS,
    ...ASSET_ORDER.map((k) => `kind-${k}`),
    // Group and view rows, whose contextValue is set in provider.ts and snippets/view.ts.
    'group',
    'typeGroup',
    'workspaceGroup',
    'attachedScope',
    'openScope',
    'userScope',
    'exportable',
    'folders',
    'noClaudeDir',
    'emptiesShown',
    'emptiesHidden',
    'message',
    'account',
    'snippet',
    'snippetTag',
  ]);
  for (const entry of allEntries) {
    for (const flag of flagsIn(entry.when ?? '')) {
      assert.ok(
        producible.has(flag),
        `${entry.command ?? entry.submenu} matches "${flag}", which nothing produces`,
      );
    }
  }
});

test('every command hidden from the palette is one that needs a tree node', () => {
  // Only this direction is decidable from the source: a handler that takes a node may still
  // work from the palette by falling back to a picker (setUpWithClaude, addWorkspaceFolder),
  // so "takes a node" does not imply "must be hidden". A stale hide, or a hide for a command
  // that is perfectly usable from the palette, is what this catches.
  const takesNode = new Set(
    [...sources.matchAll(/(?:registerCommand|command)\(\s*'(claudeExplorer\.[\w.]+)',\s*(?:async\s*)?\(\s*(?:node|target|args)\??:/g)].map(
      (m) => m[1],
    ),
  );
  for (const entry of menus.commandPalette ?? []) {
    if (entry.when !== 'false' || !entry.command) {
      continue;
    }
    assert.ok(declared.has(entry.command), `${entry.command} is hidden from the palette but no longer exists`);
    assert.ok(
      takesNode.has(entry.command),
      `${entry.command} is hidden from the palette but its handler takes no node argument`,
    );
  }
});

test('every configuration key is documented in the README', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const key of Object.keys(manifest.contributes.configuration?.properties ?? {})) {
    assert.ok(readme.includes(key), `${key} is not mentioned in README.md`);
  }
});

test('the Run submenu offers the session actions on runnable rows', () => {
  // Guards the shape of the feature: an inline insert, and a Run group holding both
  // session actions plus the new-terminal one.
  const runMenu = menus['claudeExplorer.runMenu'] ?? [];
  const ids = runMenu.map((e) => e.command);
  for (const expected of [
    'claudeExplorer.runInSession',
    'claudeExplorer.insertInSession',
    'claudeExplorer.insertMentionInSession',
    'claudeExplorer.runItem',
  ]) {
    assert.ok(ids.includes(expected), `Run submenu is missing ${expected}`);
  }
  const inline = (menus['view/item/context'] ?? []).filter((e) => e.group?.startsWith('inline'));
  assert.ok(
    inline.some((e) => e.command === 'claudeExplorer.insertInSession'),
    'insertInSession should be the inline action on a runnable row',
  );
  assert.ok(
    !inline.some((e) => e.command === 'claudeExplorer.runItem'),
    'runItem moved into the Run submenu and should no longer be inline',
  );
});
