import * as path from 'path';
import { findLine, readJson, readText } from '../util/fs';
import { describeEnv, redactCommandLine } from '../util/redact';
import { Asset, Scope } from './types';

/**
 * MCP servers, and the one thing that makes them different from every other asset here:
 * their definitions carry credentials. An `env` block is exactly where a third-party API
 * key ends up in plaintext, so nothing in this module ever puts a value into an Asset --
 * see util/redact.ts.
 *
 * A project `.mcp.json` server is also inert until it is listed in
 * `.claude/settings.local.json` -> `enabledMcpjsonServers`, so presence is not the same
 * as being active. That list can also name servers that no longer exist, which is worth
 * showing rather than hiding.
 */

interface McpServer {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: unknown;
}

interface McpFile {
  mcpServers?: Record<string, McpServer>;
}

interface LocalSettings {
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  /** Approves the whole `.mcp.json` at once. Ignoring it flagged every server as unapproved. */
  enableAllProjectMcpServers?: boolean;
}

export function discoverProjectMcp(projectRoot: string, scope: Scope): Asset[] {
  const file = path.join(projectRoot, '.mcp.json');
  const parsed = readJson<McpFile>(file);
  const local = readJson<LocalSettings>(path.join(projectRoot, '.claude', 'settings.local.json'));
  const enabledList = local?.enabledMcpjsonServers;
  const disabledList = local?.disabledMcpjsonServers ?? [];
  const approveAll = local?.enableAllProjectMcpServers === true;
  const text = readText(file);

  const out: Asset[] = [];
  const defined = Object.entries(parsed?.mcpServers ?? {});

  for (const [name, server] of defined) {
    // Three documented ways to approve: the blanket flag, the allow list, or neither.
    // An explicit disable always wins.
    const enabled = disabledList.includes(name)
      ? false
      : approveAll || (Array.isArray(enabledList) && enabledList.includes(name));
    out.push({
      kind: 'mcp',
      name,
      description: summarise(server),
      scope,
      sourcePath: file,
      line: findLine(text, `"${name}"`),
      detail: detailFor(server),
      enabled,
      toggle: { file: path.join(projectRoot, '.claude', 'settings.local.json'), target: 'mcp', key: name },
      problem: enabled
        ? undefined
        : disabledList.includes(name)
          ? 'Explicitly disabled in disabledMcpjsonServers.'
          : 'Defined but not approved — add it to enabledMcpjsonServers, or set enableAllProjectMcpServers.',
    });
  }

  // Approved names with no definition. Only meaningful when this project HAS a
  // .mcp.json: a repo with approvals but no file of its own is approving servers
  // inherited from the enclosing workspace, which is normal and not a problem.
  if (parsed?.mcpServers === undefined) {
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const definedNames = new Set(defined.map(([name]) => name));
  for (const name of enabledList ?? []) {
    if (!definedNames.has(name)) {
      out.push({
        kind: 'mcp',
        name,
        description: 'approved but not defined in this project',
        scope,
        sourcePath: path.join(projectRoot, '.claude', 'settings.local.json'),
        detail: { Source: 'enabledMcpjsonServers' },
        enabled: true,
        problem:
          'Stale approval - no server by this name in .mcp.json. It either resolves from user scope or the entry is left over from a removed server.',
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverPluginMcp(pluginRoot: string, scope: Scope): Asset[] {
  const file = path.join(pluginRoot, '.mcp.json');
  const parsed = readJson<McpFile>(file);
  const text = readText(file);
  return Object.entries(parsed?.mcpServers ?? {}).map(([name, server]) => ({
    kind: 'mcp' as const,
    name,
    description: summarise(server),
    scope,
    sourcePath: file,
    line: findLine(text, `"${name}"`),
    detail: detailFor(server),
    enabled: true,
    invocation: `plugin:${scope.label}:${name}`,
  }));
}

function summarise(server: McpServer): string {
  if (server.url) {
    return server.url;
  }
  if (server.command) {
    return redactCommandLine([server.command, ...(server.args ?? [])]);
  }
  return server.type ?? 'unknown transport';
}

function detailFor(server: McpServer): Record<string, string> {
  const detail: Record<string, string> = { Transport: server.type ?? (server.url ? 'http' : 'stdio') };
  if (server.url) {
    detail['URL'] = server.url;
  }
  if (server.command) {
    detail['Command'] = redactCommandLine([server.command, ...(server.args ?? [])]);
  }
  const env = describeEnv(server.env);
  if (env) {
    detail['Environment'] = env;
  }
  return detail;
}
