import { asText, parseFrontmatter, rawFrontmatterLine, toolList } from '../discovery/frontmatter';
import { Asset } from '../discovery/types';
import { readText } from '../util/fs';

/**
 * What a skill, command or subagent says it needs, read from its frontmatter and body:
 * the tools it is limited to, the MCP servers it names, the subagent or model it asks
 * for, and how to call it. Only names are extracted; nothing here is executed.
 */

export interface Dependencies {
  tools: string[];
  /** Server names from `mcp__<server>__…` references, in frontmatter or body. */
  mcpServers: string[];
  /**
   * Servers named above that no discovered `.mcp.json` provides where this asset runs.
   * User-level servers live in ~/.claude.json, which is not read, so this is a hint only.
   */
  missingMcpServers: string[];
  skills: string[];
  agent?: string;
  model?: string;
  /** `/name <argument-hint>`, when the asset is invocable. */
  example?: string;
  whenToUse?: string;
}

const MCP_REF = /\bmcp__([A-Za-z0-9_-]+?)(?:__[A-Za-z0-9_*-]+)?\b/g;

export function dependenciesOf(asset: Asset, all: readonly Asset[]): Dependencies | undefined {
  if (asset.placeholder || !['skill', 'command', 'agent'].includes(asset.kind)) {
    return undefined;
  }
  const text = readText(asset.sourcePath);
  if (text === undefined) {
    return undefined;
  }
  const { data, body } = parseFrontmatter(text);
  const tools = [...new Set([...toolList(data['allowed-tools']), ...toolList(data.tools)])];

  const servers = new Set<string>();
  for (const source of [...tools, body]) {
    for (const match of source.matchAll(MCP_REF)) {
      servers.add(match[1]);
    }
  }
  const configured = new Set(
    all
      .filter((a) => a.kind === 'mcp' && !a.placeholder && reaches(a, asset))
      .map((a) => a.name),
  );

  const hint = rawFrontmatterLine(text, 'argument-hint');
  return {
    tools,
    mcpServers: [...servers].sort(),
    // claude.ai connectors are fetched by Claude Code itself and never appear in a file.
    missingMcpServers: [...servers].filter((s) => !configured.has(s) && !s.startsWith('claude_ai_')).sort(),
    skills: toolList(data.skills),
    agent: asText(data.agent),
    model: asText(data.model),
    example: asset.invocation ? `${asset.invocation}${hint ? ` ${hint}` : ''}` : undefined,
    whenToUse: asText(data.when_to_use),
  };
}

/** Could an MCP server be available in a session where `asset` runs? */
function reaches(server: Asset, asset: Asset): boolean {
  if (server.scope.kind !== 'workspace' || asset.scope.kind !== 'workspace') {
    // A user-level MCP server is not discovered here (it lives in ~/.claude.json), so a
    // user or plugin asset gets the benefit of the doubt through any configured server.
    return true;
  }
  return server.scope.root === asset.scope.root;
}
