import * as os from 'os';
import * as path from 'path';
import { filesWithExtension, isFile, readJson } from '../util/fs';
import { discoverHooksFromSettings } from './hooks';
import { Asset, Scope } from './types';

/**
 * The level above the user: settings nobody on this machine chose.
 *
 * Two different things live here and they are worth telling apart:
 *
 *   managed-settings.json   deployed by an administrator to the machine. Highest
 *                           precedence of all — it overrides user and project settings
 *                           and cannot be overridden locally.
 *   policy-limits.json      pushed down from the Claude service for the signed-in
 *   remote-settings.json    organisation. They live under ~/.claude but are not user
 *                           configuration: nothing you edit there survives.
 *
 * This scope is rendered even when it is empty. "Checked, nothing set" and "never looked"
 * are different answers, and only one of them is reassuring.
 */

export const SYSTEM_SCOPE: Scope = { kind: 'system', label: 'system', root: managedSettingsDir() };

function managedSettingsDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'ClaudeCode');
    case 'darwin':
      return '/Library/Application Support/ClaudeCode';
    default:
      return '/etc/claude-code';
  }
}

export function discoverSystem(claudeDir: string): Asset[] {
  const out: Asset[] = [];
  const managed = path.join(managedSettingsDir(), 'managed-settings.json');

  if (isFile(managed)) {
    const parsed = readJson<Record<string, unknown>>(managed);
    out.push({
      kind: 'policy',
      name: 'managed-settings.json',
      description: 'administrator policy — overrides user and project settings',
      scope: SYSTEM_SCOPE,
      sourcePath: managed,
      detail: {
        Scope: 'machine-wide, deployed by an administrator',
        Precedence: 'highest — cannot be overridden locally',
        Keys: Object.keys(parsed ?? {}).join(', ') || '(empty)',
      },
    });
    // Managed settings can carry hooks, and those run for everyone on the machine.
    out.push(...discoverHooksFromSettings(managed, SYSTEM_SCOPE));
  }

  // Drop-ins, merged after the main file in alphabetical order. Numeric prefixes such as
  // `10-telemetry.json` are how administrators control that order.
  const dropInDir = path.join(managedSettingsDir(), 'managed-settings.d');
  for (const file of filesWithExtension(dropInDir, '.json')) {
    const parsed = readJson<Record<string, unknown>>(file);
    out.push({
      kind: 'policy',
      name: path.basename(file),
      description: 'managed settings drop-in',
      scope: SYSTEM_SCOPE,
      sourcePath: file,
      detail: {
        Scope: 'merged after managed-settings.json, alphabetically',
        Keys: Object.keys(parsed ?? {}).join(', ') || '(empty)',
      },
    });
    out.push(...discoverHooksFromSettings(file, SYSTEM_SCOPE));
  }

  // Enterprise MCP servers, deployed the same way as managed settings.
  const managedMcp = path.join(managedSettingsDir(), 'managed-mcp.json');
  if (isFile(managedMcp)) {
    const parsed = readJson<{ mcpServers?: Record<string, unknown> }>(managedMcp);
    const names = Object.keys(parsed?.mcpServers ?? {});
    out.push({
      kind: 'policy',
      name: 'managed-mcp.json',
      description: `${names.length} administrator-deployed MCP server${names.length === 1 ? '' : 's'}`,
      scope: SYSTEM_SCOPE,
      sourcePath: managedMcp,
      detail: { Servers: names.join(', ') || '(none)' },
    });
  }

  for (const [file, what] of [
    ['policy-limits.json', 'usage limits and compliance policy pushed by your organization'],
    ['remote-settings.json', 'settings pushed by your organization'],
  ] as const) {
    const full = path.join(claudeDir, file);
    if (!isFile(full)) {
      continue;
    }
    const parsed = readJson<Record<string, unknown>>(full);
    out.push({
      kind: 'policy',
      name: file,
      description: what,
      scope: SYSTEM_SCOPE,
      sourcePath: full,
      detail: {
        Scope: 'pushed from the Claude service for your organization',
        Editable: 'no — it is replaced on the next sync',
        Keys: Object.keys(parsed ?? {}).join(', ') || '(empty)',
      },
    });
  }

  return out;
}

/** Where the extension looked, so an empty System group can say so. */
export function systemSearchPaths(claudeDir: string): string[] {
  return [
    path.join(managedSettingsDir(), 'managed-settings.json'),
    path.join(managedSettingsDir(), 'managed-settings.d'),
    path.join(managedSettingsDir(), 'managed-mcp.json'),
    path.join(claudeDir, 'policy-limits.json'),
    path.join(claudeDir, 'remote-settings.json'),
  ];
}

/**
 * Windows policy can also arrive through the registry, under a `Settings` value at
 * HKLM\\SOFTWARE\\Policies\\ClaudeCode (and HKCU). Reading the registry from an extension
 * means spawning `reg.exe` on every refresh, which is not worth it for a browser -- but
 * saying so beats silently ignoring a delivery mechanism that really is in the docs.
 */
export const REGISTRY_POLICY_NOTE =
  process.platform === 'win32'
    ? 'Policy can also be set in HKLM or HKCU \\\\SOFTWARE\\\\Policies\\\\ClaudeCode (value: Settings). This extension does not read the registry.'
    : undefined;

export function homeClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}
