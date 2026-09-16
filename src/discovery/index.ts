import * as path from 'path';
import { filesWithExtension, isDir, isFile, mtime, readJson, subdirs } from '../util/fs';
import { Account, readAccount } from './account';
import { discoverHooksFromSettings, discoverPluginHooks } from './hooks';
import { discoverAgents, discoverCommands, discoverNestedAgents, discoverSkills } from './markdownAssets';
import { discoverProjectMcp, discoverPluginMcp } from './mcp';
import {
  discoverPlugins,
  PluginInstall,
  pluginManifest,
  pluginScope,
  resolveExtraScopes,
  inheritedFrom,
  resolveWorkspaceScopes,
  userClaudeDir,
} from './scopes';
import { discoverProjectPlans, discoverUserPlans } from './plans';
import { discoverSettings, settingsFilesFor } from './settings';
import { discoverFromRegistry, placeholdersFor } from './surfaces';
import { discoverSystem, SYSTEM_SCOPE } from './system';
import { applyOverrides } from '../analysis/overrides';
import { Asset, AssetKind, Scope, USER_SCOPE } from './types';

export interface CollectOptions {
  workspaceFolders: readonly string[];
  extraProjectPaths: readonly string[];
  showPluginProvided: boolean;
  /** Greyed rows for surfaces a scope supports but has nothing for. */
  showPlaceholders: boolean;
}

export interface Collection {
  assets: Asset[];
  scopes: Scope[];
  /** Who is signed in to Claude Code, or that nobody is. Never blocks discovery. */
  account: Account;
  /** Shown in the view when a folder is open but has no configuration. */
  note?: string;
  /**
   * Configuration outside the open folder that still applies to it -- Claude Code
   * concatenates CLAUDE.md from every ancestor. Reported, never turned into scopes.
   */
  inherited: string[];
}

export function collect(options: CollectOptions): Collection {
  const assets: Asset[] = [];
  const claudeDir = userClaudeDir();
  const userScope = USER_SCOPE(claudeDir);
  const scopes: Scope[] = [SYSTEM_SCOPE, userScope];

  // --- system: administrator policy and anything the org pushes down ----------------
  assets.push(...discoverSystem(claudeDir));

  // --- user -------------------------------------------------------------------------
  assets.push(...discoverSkills(path.join(claudeDir, 'skills'), userScope));
  assets.push(...discoverCommands(path.join(claudeDir, 'commands'), userScope));
  assets.push(...discoverAgents(path.join(claudeDir, 'agents'), userScope));
  assets.push(...discoverFromRegistry(claudeDir, userScope));
  for (const file of settingsFilesFor(userScope, claudeDir)) {
    assets.push(...discoverSettings(file, userScope));
    assets.push(...discoverHooksFromSettings(file, userScope));
  }
  assets.push(...discoverUserPlans(claudeDir, userScope, cleanupDays(claudeDir)));
  assets.push(...userMemory(claudeDir, userScope));

  // --- plugins ----------------------------------------------------------------------
  if (options.showPluginProvided) {
    for (const plugin of discoverPlugins(claudeDir)) {
      const scope = pluginScope(plugin);
      scopes.push(scope);
      assets.push(pluginAsset(plugin, scope));
      assets.push(...discoverSkills(path.join(plugin.installPath, 'skills'), scope));
      assets.push(...discoverCommands(path.join(plugin.installPath, 'commands'), scope));
      assets.push(...discoverAgents(path.join(plugin.installPath, 'agents'), scope));
      assets.push(...discoverNestedAgents(plugin.installPath, scope));
      assets.push(...discoverPluginHooks(plugin.installPath, scope));
      assets.push(...discoverPluginMcp(plugin.installPath, scope));
      assets.push(...discoverFromRegistry(plugin.installPath, scope));
      assets.push(...discoverPluginLsp(plugin, scope));
    }
  }

  // --- workspaces -------------------------------------------------------------------
  const workspace = resolveWorkspaceScopes(options.workspaceFolders);
  const allWorkspaceScopes = [...workspace.scopes, ...resolveExtraScopes(options.extraProjectPaths)];
  for (const scope of allWorkspaceScopes) {
    scopes.push(scope);
    const dir = path.join(scope.root, '.claude');
    assets.push(...discoverSkills(path.join(dir, 'skills'), scope));
    assets.push(...discoverCommands(path.join(dir, 'commands'), scope));
    assets.push(...discoverAgents(path.join(dir, 'agents'), scope));
    assets.push(...discoverFromRegistry(scope.root, scope));
    for (const file of settingsFilesFor(scope, scope.root)) {
      assets.push(...discoverSettings(file, scope));
      assets.push(...discoverHooksFromSettings(file, scope));
    }
    assets.push(...discoverProjectMcp(scope.root, scope));
    assets.push(...discoverProjectPlans(dir, scope));
    assets.push(...projectMemory(scope));
  }

  // --- placeholders -----------------------------------------------------------------
  // Only for the scopes the user is actually working in. Emitting them for every nested
  // repo would bury the real content under dozens of greyed rows in a multi-repo workspace.
  if (options.showPlaceholders) {
    assets.push(...placeholdersFor(SYSTEM_SCOPE.root, SYSTEM_SCOPE, kindsIn(assets, SYSTEM_SCOPE)));
    assets.push(...placeholdersFor(claudeDir, userScope, kindsIn(assets, userScope)));
    for (const scope of allWorkspaceScopes.filter((s) => s.primary)) {
      assets.push(...placeholdersFor(scope.root, scope, kindsIn(assets, scope)));
    }
  }

  applyOverrides(assets, scopes);

  // One central pass for timestamps rather than a stat at every construction site.
  for (const asset of assets) {
    asset.modified = asset.placeholder ? undefined : mtime(asset.sourcePath);
  }

  return {
    assets,
    scopes,
    account: readAccount(claudeDir),
    note: workspace.note,
    inherited: options.workspaceFolders.flatMap((f) => inheritedFrom(f)),
  };
}

/** `cleanupPeriodDays` decides how long a plan-mode file survives; default is 30. */
function cleanupDays(claudeDir: string): number | undefined {
  const settings = readJson<{ cleanupPeriodDays?: number }>(path.join(claudeDir, 'settings.json'));
  return typeof settings?.cleanupPeriodDays === 'number' ? settings.cleanupPeriodDays : undefined;
}

function kindsIn(assets: readonly Asset[], scope: Scope): Set<AssetKind> {
  const out = new Set<AssetKind>();
  for (const asset of assets) {
    if (asset.scope.root === scope.root) {
      out.add(asset.kind);
    }
  }
  return out;
}

function pluginAsset(plugin: PluginInstall, scope: Scope): Asset {
  const manifest = pluginManifest(plugin);
  return {
    kind: 'plugin',
    name: plugin.name,
    description: `${plugin.marketplace} · ${plugin.version}`,
    scope,
    sourcePath: manifest ?? plugin.installPath,
    enabled: plugin.enabled,
    toggle: {
      file: path.join(userClaudeDir(), 'settings.json'),
      target: 'plugin',
      key: plugin.marketplace ? `${plugin.name}@${plugin.marketplace}` : plugin.name,
    },
    docs: 'https://code.claude.com/docs/en/plugins',
    detail: {
      Marketplace: plugin.marketplace,
      Version: plugin.version,
      Path: plugin.installPath,
      Manifest: manifest ? path.basename(manifest) : 'none (catalog-only plugin)',
    },
    problem: plugin.enabled ? undefined : 'Installed but not enabled in settings.json',
  };
}

interface PluginManifestFile {
  lspServers?: Record<
    string,
    { command?: string; args?: string[]; extensionToLanguage?: Record<string, string> }
  >;
}

/**
 * Language servers a plugin provides -- declared either in a `.lsp.json` at the plugin
 * root or as `lspServers` inside plugin.json.
 *
 * Some LSP plugins ship neither: `pyright-lsp` has no manifest at all and its definition
 * lives only in the marketplace catalog. Reporting nothing for an installed, active
 * language server would be the same mistake as hiding a project with no `.claude/`.
 */
function discoverPluginLsp(plugin: PluginInstall, scope: Scope): Asset[] {
  const out: Asset[] = [];
  const docs = 'https://code.claude.com/docs/en/plugins-reference';

  const standalone = path.join(plugin.installPath, '.lsp.json');
  const manifest = pluginManifest(plugin);
  const source = isFile(standalone) ? standalone : manifest;
  const parsed = source ? readJson<PluginManifestFile>(source) : undefined;

  for (const [name, server] of Object.entries(parsed?.lspServers ?? {})) {
    out.push({
      kind: 'lsp',
      name,
      description: [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
      scope,
      sourcePath: source ?? plugin.installPath,
      docs,
      detail: {
        Languages: Object.values(server.extensionToLanguage ?? {}).join(', ') || '(unspecified)',
        Extensions: Object.keys(server.extensionToLanguage ?? {}).join(', ') || '(unspecified)',
      },
    });
  }

  if (out.length === 0 && /-lsp$/.test(plugin.name)) {
    out.push({
      kind: 'lsp',
      name: plugin.name,
      description: 'language server declared in the marketplace catalog',
      scope,
      sourcePath: plugin.installPath,
      docs,
      detail: {
        Note: 'This plugin ships no plugin.json; its LSP definition lives in marketplace.json.',
      },
    });
  }
  return out;
}

/** CLAUDE.md at the user level, the user plan store, and the per-project memory notes. */
function userMemory(claudeDir: string, scope: Scope): Asset[] {
  const out: Asset[] = [];
  const claudeMd = path.join(claudeDir, 'CLAUDE.md');
  if (isFile(claudeMd)) {
    out.push({
      kind: 'memory',
      name: 'CLAUDE.md',
      description: 'user-level instructions, loaded in every project',
      scope,
      sourcePath: claudeMd,
      docs: 'https://code.claude.com/docs/en/memory',
    });
  }

  const projectsDir = path.join(claudeDir, 'projects');
  for (const slug of subdirs(projectsDir)) {
    const memoryDir = path.join(projectsDir, slug, 'memory');
    if (!isDir(memoryDir)) {
      continue;
    }
    const notes = filesWithExtension(memoryDir, '.md').filter(
      (f) => path.basename(f) !== 'MEMORY.md',
    );
    if (notes.length === 0) {
      continue;
    }
    const index = path.join(memoryDir, 'MEMORY.md');
    out.push({
      kind: 'memory',
      name: readableSlug(slug),
      description: `${notes.length} auto-memory note${notes.length === 1 ? '' : 's'}`,
      scope,
      sourcePath: isFile(index) ? index : notes[0],
      detail: { Directory: memoryDir, Setting: 'autoMemoryEnabled' },
    });
  }
  return out;
}

function projectMemory(scope: Scope): Asset[] {
  const out: Asset[] = [];
  // Three documented locations; CLAUDE.local.md is the private one people forget exists.
  for (const [rel, what] of [
    ['CLAUDE.md', 'project instructions'],
    ['.claude/CLAUDE.md', 'project instructions (alternate location)'],
    ['CLAUDE.local.md', 'private project instructions, not committed'],
  ] as const) {
    const file = path.join(scope.root, rel);
    if (isFile(file)) {
      out.push({
        kind: 'memory',
        name: rel,
        description: `${what} for ${scope.label}`,
        scope,
        sourcePath: file,
        docs: 'https://code.claude.com/docs/en/memory',
      });
    }
  }

  return out;
}

/**
 * Claude Code slugs a project path by replacing every non-alphanumeric run with `-`, so
 * the original separators are unrecoverable. Taking the last token was wrong for any
 * hyphenated name (`claude-explorer` became "explorer"). Instead, keep the tail after the
 * last path-ish marker and restore it as a readable name.
 */
function readableSlug(slug: string): string {
  const cleaned = slug.replace(/^-+/, '');
  const marker = /-(?:projects|repos|src|dev|work|code|git)-/i.exec(cleaned);
  const tail = marker ? cleaned.slice(marker.index + marker[0].length) : cleaned;
  return tail || slug;
}
