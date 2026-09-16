import * as path from 'path';
import { filesWithExtension, isDir, isFile, readJson, readText } from '../util/fs';
import { asText, firstMeaningfulLine, parseFrontmatter } from './frontmatter';
import { Asset, AssetKind, Scope, ScopeKind } from './types';

/**
 * The catalogue of configuration surfaces Claude Code supports, declared once.
 *
 * Two jobs. Simple surfaces (a directory of markdown, a single JSON file) are discovered
 * generically from this table, so adding one is a table entry rather than another reader.
 * And every surface -- including the ones with bespoke readers -- contributes a
 * PLACEHOLDER when a scope has nothing for it, which is what turns the sidebar from an
 * inventory of what exists into a map of what is available.
 *
 * Paths are from the official docs (code.claude.com/docs/en/claude-directory). They are
 * relative to the scope's base: `~/.claude` for user, the project root for workspace, the
 * plugin root for plugin, the managed settings directory for system.
 */

export type LocationType = 'dir' | 'file';

export interface SurfaceLocation {
  scope: ScopeKind;
  /** Relative to the scope base. For workspace this includes the `.claude/` prefix. */
  rel: string;
  type: LocationType;
  /** For `dir`: which extension to list. */
  ext?: string;
}

export interface Surface {
  kind: AssetKind;
  docs: string;
  /** A bespoke reader already handles this; the registry supplies only placeholders. */
  bespoke?: boolean;
  locations: SurfaceLocation[];
}

const DOCS = 'https://code.claude.com/docs/en';

export const SURFACES: Surface[] = [
  {
    kind: 'skill',
    docs: `${DOCS}/skills`,
    bespoke: true,
    locations: [
      { scope: 'user', rel: 'skills', type: 'dir' },
      { scope: 'workspace', rel: '.claude/skills', type: 'dir' },
      { scope: 'plugin', rel: 'skills', type: 'dir' },
    ],
  },
  {
    kind: 'command',
    docs: `${DOCS}/slash-commands`,
    bespoke: true,
    locations: [
      { scope: 'user', rel: 'commands', type: 'dir', ext: '.md' },
      { scope: 'workspace', rel: '.claude/commands', type: 'dir', ext: '.md' },
      { scope: 'plugin', rel: 'commands', type: 'dir', ext: '.md' },
    ],
  },
  {
    kind: 'agent',
    docs: `${DOCS}/sub-agents`,
    bespoke: true,
    locations: [
      { scope: 'user', rel: 'agents', type: 'dir', ext: '.md' },
      { scope: 'workspace', rel: '.claude/agents', type: 'dir', ext: '.md' },
      { scope: 'plugin', rel: 'agents', type: 'dir', ext: '.md' },
    ],
  },
  {
    // Rules load like CLAUDE.md but can be scoped to globs with a `paths:` frontmatter key.
    kind: 'rule',
    docs: `${DOCS}/memory`,
    locations: [
      { scope: 'user', rel: 'rules', type: 'dir', ext: '.md' },
      { scope: 'workspace', rel: '.claude/rules', type: 'dir', ext: '.md' },
    ],
  },
  {
    kind: 'outputStyle',
    docs: `${DOCS}/output-styles`,
    locations: [
      { scope: 'user', rel: 'output-styles', type: 'dir', ext: '.md' },
      { scope: 'workspace', rel: '.claude/output-styles', type: 'dir', ext: '.md' },
      { scope: 'plugin', rel: 'output-styles', type: 'dir', ext: '.md' },
    ],
  },
  {
    kind: 'theme',
    docs: `${DOCS}/plugins-reference`,
    locations: [{ scope: 'user', rel: 'themes', type: 'dir', ext: '.json' }],
  },
  {
    kind: 'workflow',
    docs: `${DOCS}/workflows`,
    locations: [
      { scope: 'user', rel: 'workflows', type: 'dir', ext: '.js' },
      { scope: 'workspace', rel: '.claude/workflows', type: 'dir', ext: '.js' },
      { scope: 'plugin', rel: 'workflows', type: 'dir', ext: '.js' },
    ],
  },
  {
    kind: 'keybinding',
    docs: `${DOCS}/keybindings`,
    locations: [{ scope: 'user', rel: 'keybindings.json', type: 'file' }],
  },
  { kind: 'hook', docs: `${DOCS}/hooks`, bespoke: true, locations: [
      { scope: 'user', rel: 'settings.json', type: 'file' },
      { scope: 'workspace', rel: '.claude/settings.json', type: 'file' },
      { scope: 'plugin', rel: 'hooks/hooks.json', type: 'file' },
    ] },
  { kind: 'mcp', docs: `${DOCS}/mcp`, bespoke: true, locations: [
      { scope: 'workspace', rel: '.mcp.json', type: 'file' },
      { scope: 'plugin', rel: '.mcp.json', type: 'file' },
    ] },
  { kind: 'lsp', docs: `${DOCS}/plugins-reference`, bespoke: true, locations: [
      { scope: 'plugin', rel: '.lsp.json', type: 'file' },
    ] },
  { kind: 'setting', docs: `${DOCS}/settings`, bespoke: true, locations: [
      { scope: 'user', rel: 'settings.json', type: 'file' },
      { scope: 'workspace', rel: '.claude/settings.json', type: 'file' },
    ] },
  { kind: 'policy', docs: `${DOCS}/managed-settings`, bespoke: true, locations: [
      { scope: 'system', rel: 'managed-settings.json', type: 'file' },
    ] },
  { kind: 'plugin', docs: `${DOCS}/plugins`, bespoke: true, locations: [] },
  { kind: 'plan', docs: `${DOCS}/permission-modes`, bespoke: true, locations: [
      { scope: 'user', rel: 'plans', type: 'dir', ext: '.md' },
      { scope: 'workspace', rel: '.claude/plans', type: 'dir', ext: '.md' },
    ] },
  { kind: 'memory', docs: `${DOCS}/memory`, bespoke: true, locations: [
      { scope: 'user', rel: 'CLAUDE.md', type: 'file' },
      { scope: 'workspace', rel: 'CLAUDE.md', type: 'file' },
    ] },
];

/** Generic discovery for the surfaces that are just files in a known place. */
export function discoverFromRegistry(base: string, scope: Scope): Asset[] {
  const out: Asset[] = [];
  for (const surface of SURFACES) {
    if (surface.bespoke) {
      continue;
    }
    for (const loc of surface.locations) {
      if (loc.scope !== scope.kind) {
        continue;
      }
      const target = path.join(base, loc.rel);
      if (loc.type === 'file') {
        if (isFile(target)) {
          out.push(describeFile(target, surface, scope));
        }
        continue;
      }
      if (!isDir(target)) {
        continue;
      }
      for (const file of filesWithExtension(target, loc.ext ?? '.md')) {
        out.push(describeFile(file, surface, scope));
      }
    }
  }
  return out;
}

function describeFile(file: string, surface: Surface, scope: Scope): Asset {
  const base: Asset = {
    kind: surface.kind,
    name: path.basename(file),
    scope,
    sourcePath: file,
    docs: surface.docs,
  };

  if (file.toLowerCase().endsWith('.md')) {
    const { data, body } = parseFrontmatter(readText(file) ?? '');
    base.name = asText(data.name) ?? path.basename(file, '.md');
    base.description = asText(data.description) ?? firstMeaningfulLine(body);
    const detail: Record<string, string> = {};
    // `paths:` is what makes a rule conditional rather than always-on -- worth surfacing.
    const paths = asText(data.paths);
    if (paths) {
      detail['Applies to'] = paths;
    }
    for (const key of ['keep-coding-instructions', 'force-for-plugin']) {
      const value = asText(data[key]);
      if (value) {
        detail[key] = value;
      }
    }
    if (Object.keys(detail).length > 0) {
      base.detail = detail;
    }
    return base;
  }

  if (file.toLowerCase().endsWith('.json')) {
    const parsed = readJson<Record<string, unknown>>(file);
    base.name = path.basename(file, '.json');
    base.description = summariseJson(surface.kind, parsed);
    base.detail = { Keys: Object.keys(parsed ?? {}).join(', ') || '(empty)' };
    return base;
  }

  base.description = 'script';
  return base;
}

interface KeybindingsFile {
  bindings?: Array<{ context?: string; bindings?: Record<string, string | null> }>;
}

function summariseJson(kind: AssetKind, parsed: Record<string, unknown> | undefined): string {
  if (kind === 'keybinding') {
    const contexts = (parsed as KeybindingsFile | undefined)?.bindings ?? [];
    const total = contexts.reduce((n, c) => n + Object.keys(c.bindings ?? {}).length, 0);
    return `${contexts.length} contexts · ${total} bindings`;
  }
  return Object.keys(parsed ?? {}).join(', ');
}

/**
 * One greyed row per surface a scope supports but has nothing for.
 *
 * Only for scopes the user is actually working in -- system, user, and the project they
 * opened. Emitting them for every nested repo would add ~80 rows of noise to a workspace
 * with many repos and bury the real content.
 */
export function placeholdersFor(base: string, scope: Scope, present: ReadonlySet<AssetKind>): Asset[] {
  const out: Asset[] = [];
  for (const surface of SURFACES) {
    if (present.has(surface.kind)) {
      continue;
    }
    const locations = surface.locations.filter((l) => l.scope === scope.kind);
    if (locations.length === 0) {
      continue;
    }
    const where = locations.map((l) => path.join(base, l.rel)).join('  ·  ');
    out.push({
      kind: surface.kind,
      name: 'none',
      description: shorten(locations.map((l) => l.rel).join(' · ')),
      scope,
      sourcePath: path.join(base, locations[0].rel),
      placeholder: true,
      docs: surface.docs,
      detail: {
        Status: 'supported here, nothing configured',
        'Would live in': where,
      },
    });
  }
  return out;
}

function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * The directories a surface lives in for one scope, given that scope's base (`~/.claude`
 * for user, the project root for workspace, the install path for a plugin). For a surface
 * that is a single file, the directory containing it.
 */
export function surfaceDirs(kind: AssetKind, scope: ScopeKind, base: string): string[] {
  const surface = SURFACES.find((s) => s.kind === kind);
  return (surface?.locations ?? [])
    .filter((l) => l.scope === scope)
    .map((l) => (l.type === 'dir' ? path.join(base, l.rel) : path.dirname(path.join(base, l.rel))));
}
