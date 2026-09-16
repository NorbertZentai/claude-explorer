import { readJson } from '../util/fs';

/**
 * A server's definition exactly as written in `.mcp.json`. Deliberately never stored on an
 * Asset: env values and headers are credentials. Callers read it on demand, use it, and
 * redact anything they show.
 */
export interface McpServerDefinition {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export function readServer(file: string, name: string): McpServerDefinition | undefined {
  const parsed = readJson<{ mcpServers?: Record<string, McpServerDefinition> }>(file);
  const server = parsed?.mcpServers?.[name];
  return server && typeof server === 'object' ? server : undefined;
}

export function transportOf(server: McpServerDefinition): 'stdio' | 'http' | 'sse' {
  if (server.type === 'http' || server.type === 'sse') {
    return server.type;
  }
  return server.url && !server.command ? 'http' : 'stdio';
}

/**
 * Claude Code expands `${VAR}` and `${VAR:-default}` in command, args, env, url and
 * headers. An unset variable with no default is left as written, as Claude Code does.
 */
export function expandVars(value: string, env: Readonly<Record<string, string | undefined>>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name: string, fallback?: string) => {
    const resolved = env[name];
    if (resolved !== undefined && resolved !== '') {
      return resolved;
    }
    return fallback !== undefined ? fallback : whole;
  });
}
