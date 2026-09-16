import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isDir, isFile, readJson } from '../util/fs';
import { Scope } from './types';

/**
 * Where to look for configuration.
 *
 * The rule is deliberately literal: **a scope is a folder you opened**. No walking up to
 * find an enclosing "real" workspace, no scanning siblings. Open one repo inside a
 * monorepo and you get that repo, not its twelve neighbours.
 *
 * An earlier version resolved the outermost ancestor carrying a `.claude/` and then listed
 * every child that looked like a project. It was clever and it was wrong -- opening one
 * repo showed six. It also produced both portability bugs this file used to have: the home
 * directory being scanned when a path arrived as a Windows 8.3 short name, and `.claude`
 * itself being detected as a project because `.claude/CLAUDE.md` is a documented location.
 * Deleting the walk-up deleted both.
 *
 * Extra folders are added explicitly by the user and remembered per workspace.
 */

/** `CLAUDE_CONFIG_DIR` relocates the whole user directory; honouring it is not optional. */
export function userClaudeDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.claude');
}

export interface WorkspaceScopes {
  scopes: Scope[];
  /** Shown under the tree when a folder is open but carries no configuration. */
  note?: string;
}

/** The folders VS Code has open. Each becomes exactly one scope. */
export function resolveWorkspaceScopes(folders: readonly string[]): WorkspaceScopes {
  const found = new Map<string, Scope>();
  for (const folder of folders) {
    addScope(found, folder, { primary: true });
  }
  const scopes = [...found.values()].sort((a, b) => a.label.localeCompare(b.label));

  if (folders.length > 0 && scopes.every((s) => !s.hasConfigDir)) {
    return {
      scopes,
      note: 'No .claude directory in the open folder — use + to attach another project.',
    };
  }
  return { scopes };
}

/** Folders attached by hand. Scanned whether or not they are open. */
export function resolveExtraScopes(paths: readonly string[]): Scope[] {
  const found = new Map<string, Scope>();
  for (const p of paths) {
    if (p.trim() !== '' && isDir(p)) {
      addScope(found, p, { primary: true, attached: true });
    }
  }
  return [...found.values()];
}

/**
 * Configuration an open folder inherits from a parent directory.
 *
 * Claude Code concatenates `CLAUDE.md` from every ancestor, so a repo inside a workspace
 * really is governed by files outside it. Those are reported as a note rather than as
 * scopes: they affect this folder, but they are not this folder.
 */
export function inheritedFrom(folder: string): string[] {
  const out: string[] = [];
  const home = realPath(os.homedir());
  let current = realPath(folder);

  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    if (dedupKey(current) === dedupKey(home)) {
      break; // ~/.claude is the User scope, already shown in its own right
    }
    for (const rel of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')]) {
      const candidate = path.join(current, rel);
      if (isFile(candidate)) {
        out.push(candidate);
      }
    }
  }
  return out;
}

interface ScopeFlags {
  primary?: boolean;
  attached?: boolean;
}

function addScope(into: Map<string, Scope>, root: string, flags: ScopeFlags): void {
  const resolved = realPath(root);
  const key = dedupKey(resolved);
  const existing = into.get(key);
  if (existing) {
    existing.primary = existing.primary || flags.primary;
    return;
  }
  into.set(key, {
    kind: 'workspace',
    label: path.basename(resolved) || resolved,
    root: resolved,
    hasConfigDir: isDir(path.join(resolved, '.claude')),
    primary: flags.primary,
    attached: flags.attached,
  });
}

/**
 * Resolve through the filesystem before comparing paths. `path.resolve` alone does not
 * expand a Windows 8.3 short name (`C:\Users\RUNNER~1.DEV`) or follow a symlinked home, so
 * a string comparison silently misses and the wrong directory is treated as new.
 */
export function realPath(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

/** Case-insensitive only where the filesystem is. On Linux `Foo` and `foo` differ. */
function dedupKey(resolved: string): string {
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string): boolean {
  return dedupKey(realPath(a)) === dedupKey(realPath(b));
}

export interface PluginInstall {
  name: string;
  marketplace: string;
  version: string;
  installPath: string;
  enabled: boolean;
}

interface InstalledPluginsFile {
  plugins?: Record<string, Array<{ installPath?: string; version?: string }>>;
}

interface UserSettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

/**
 * Plugins come from `installed_plugins.json`, not from a recursive search for
 * `plugin.json`: some plugins ship no manifest at all, and others ship several parallel
 * ones that a recursive search would count more than once. The version segment of the
 * cache path is a semver OR a git sha, so the install path is read, never globbed.
 */
export function discoverPlugins(claudeDir: string): PluginInstall[] {
  const installed = readJson<InstalledPluginsFile>(
    path.join(claudeDir, 'plugins', 'installed_plugins.json'),
  );
  const settings = readJson<UserSettingsFile>(path.join(claudeDir, 'settings.json'));
  const enabledMap = settings?.enabledPlugins ?? {};
  const out: PluginInstall[] = [];

  for (const [key, entries] of Object.entries(installed?.plugins ?? {})) {
    // Hand-edited or future-shaped JSON must never throw; a wrong shape is skipped.
    if (!Array.isArray(entries)) {
      continue;
    }
    const at = key.lastIndexOf('@');
    const name = at > 0 ? key.slice(0, at) : key;
    const marketplace = at > 0 ? key.slice(at + 1) : '';
    for (const entry of entries) {
      if (!entry?.installPath || !isDir(entry.installPath)) {
        continue;
      }
      out.push({
        name,
        marketplace,
        version: entry.version ?? path.basename(entry.installPath),
        installPath: entry.installPath,
        enabled: enabledMap[key] === true,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function pluginScope(plugin: PluginInstall): Scope {
  return { kind: 'plugin', label: plugin.name, root: plugin.installPath };
}

/** Where a plugin's manifest lives, when it has one at all. */
export function pluginManifest(plugin: PluginInstall): string | undefined {
  const candidate = path.join(plugin.installPath, '.claude-plugin', 'plugin.json');
  return isFile(candidate) ? candidate : undefined;
}

/** Used to warn before attaching a folder that holds no Claude configuration. */
export function looksLikeProject(folder: string): boolean {
  return (
    isDir(path.join(folder, '.claude')) ||
    isDir(path.join(folder, '.git')) ||
    isFile(path.join(folder, 'CLAUDE.md')) ||
    isFile(path.join(folder, '.mcp.json'))
  );
}

export const hasClaudeConfig = looksLikeProject;
