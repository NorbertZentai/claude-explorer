import { redactCommandLine } from '../util/redact';
import { McpServerDefinition, transportOf } from './definition';

/**
 * A `claude mcp add` command that recreates a server elsewhere. Every env and header value
 * becomes a `<value>` placeholder and credential-looking arguments are masked, so the
 * command is safe to paste into a chat or a README. Syntax from code.claude.com/docs/en/mcp.
 */
export function buildAddCommand(name: string, server: McpServerDefinition, projectScoped: boolean): string {
  const parts = ['claude', 'mcp', 'add'];
  const transport = transportOf(server);
  parts.push('--transport', transport);
  if (projectScoped) {
    parts.push('--scope', 'project');
  }

  if (transport !== 'stdio') {
    parts.push(quote(name), quote(server.url ?? '<url>'));
    for (const header of Object.keys(server.headers ?? {})) {
      parts.push('--header', quote(`${header}: <value>`));
    }
    return parts.join(' ');
  }

  for (const key of Object.keys(server.env ?? {}).sort()) {
    parts.push('-e', quote(`${key}=<value>`));
  }
  const command = [server.command ?? '<command>', ...(server.args ?? [])];
  // Mask each word on its own, then quote it: an argument may contain spaces.
  parts.push(quote(name), '--', ...command.map((word) => quote(redactCommandLine([word]))));
  return parts.join(' ');
}

/** POSIX single-quote anything a shell would split or expand. */
function quote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./•-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
