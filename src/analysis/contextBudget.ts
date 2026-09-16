import * as path from 'path';
import { asText, parseFrontmatter } from '../discovery/frontmatter';
import { inheritedFrom } from '../discovery/scopes';
import { Asset } from '../discovery/types';
import { readText } from '../util/fs';

/**
 * A rough estimate of how much context a Claude Code session in one project spends on
 * configuration before the first prompt. Always labelled an estimate: tokens are taken as
 * characters / 4, which is close for English prose and wrong for everything else.
 *
 * What loads at startup, per code.claude.com/docs:
 *   - every CLAUDE.md in full: user, project, .claude/, CLAUDE.local.md, and ancestors
 *   - the first 200 lines of the auto-memory MEMORY.md index
 *   - rules without a `paths:` key (rules with one load only when a matching file is read)
 *   - skill listings: `description` + `when_to_use`, truncated at 1,536 characters,
 *     unless `disable-model-invocation` keeps the skill out of the listing
 *   - command and subagent descriptions
 * MCP tool definitions also load, but measuring them means starting the servers.
 */

export interface BudgetRow {
  category: 'Memory' | 'Rules' | 'Skills' | 'Commands' | 'Subagents' | 'MCP tools';
  name: string;
  scopeLabel: string;
  sourcePath: string;
  chars: number;
  tokens: number;
  note?: string;
  /** Heuristic, and labelled as such wherever it is shown. */
  warning?: string;
}

export interface BudgetReport {
  rows: BudgetRow[];
  totalTokens: number;
  /** Things that do cost context but cannot be measured from files. */
  unmeasured: string[];
}

const SKILL_LISTING_LIMIT = 1536;
const MEMORY_INDEX_LINES = 200;
const LARGE_FILE_TOKENS = 5000;

/** Tool definitions measured by "Test MCP Server", keyed by `mcpMeasurementKey`. */
export type McpMeasurements = ReadonlyMap<string, { tools: number; chars: number }>;

export function mcpMeasurementKey(sourcePath: string, name: string): string {
  return `${sourcePath}#${name}`;
}

export function estimateBudget(
  assets: readonly Asset[],
  workspaceRoot: string | undefined,
  measurements: McpMeasurements = new Map(),
): BudgetReport {
  const inSession = assets.filter((a) => !a.placeholder && appliesTo(a, workspaceRoot));
  const rows: BudgetRow[] = [];

  for (const asset of inSession) {
    switch (asset.kind) {
      case 'memory':
        rows.push(memoryRow(asset));
        break;
      case 'rule':
        if (!asset.detail?.['Applies to']) {
          rows.push(fileRow('Rules', asset, readText(asset.sourcePath) ?? ''));
        }
        break;
      case 'skill': {
        const row = skillRow(asset);
        if (row) {
          rows.push(row);
        }
        break;
      }
      case 'command':
        rows.push(textRow('Commands', asset, asset.description ?? ''));
        break;
      case 'agent': {
        const { data } = parseFrontmatter(readText(asset.sourcePath) ?? '');
        rows.push(textRow('Subagents', asset, asText(data.description) ?? asset.description ?? ''));
        break;
      }
    }
  }

  // CLAUDE.md files in folders above the project are concatenated too.
  if (workspaceRoot) {
    for (const file of inheritedFrom(workspaceRoot)) {
      const text = readText(file) ?? '';
      rows.push(
        withWarning({
          category: 'Memory',
          name: file,
          scopeLabel: 'parent folder',
          sourcePath: file,
          chars: text.length,
          tokens: tokens(text.length),
          note: 'inherited from a parent folder',
        }),
      );
    }
  }

  rows.sort((a, b) => b.tokens - a.tokens);
  let mcp = 0;
  for (const server of inSession.filter((a) => a.kind === 'mcp' && a.enabled !== false)) {
    const measured = measurements.get(mcpMeasurementKey(server.sourcePath, server.name));
    if (!measured) {
      mcp++;
      continue;
    }
    rows.push({
      category: 'MCP tools',
      name: server.invocation ?? server.name,
      scopeLabel: server.scope.label,
      sourcePath: server.sourcePath,
      chars: measured.chars,
      tokens: tokens(measured.chars),
      note: `${measured.tools} tool${measured.tools === 1 ? '' : 's'}, measured this session`,
    });
  }
  rows.sort((a, b) => b.tokens - a.tokens);
  const unmeasured = ['the system prompt and built-in tool definitions'];
  if (mcp > 0) {
    unmeasured.push(`tool definitions of ${mcp} MCP server${mcp === 1 ? '' : 's'} (use Test MCP Server to measure)`);
  }
  unmeasured.push('rules with `paths:` and full skill bodies, which load only when used');

  return { rows, totalTokens: rows.reduce((n, r) => n + r.tokens, 0), unmeasured };
}

/** User, system and enabled plugins apply everywhere; a project only to itself. */
function appliesTo(asset: Asset, workspaceRoot: string | undefined): boolean {
  if (asset.overriddenBy?.everywhere || (workspaceRoot && asset.overriddenBy?.inRoots?.includes(workspaceRoot))) {
    return false;
  }
  switch (asset.scope.kind) {
    case 'workspace':
      return asset.scope.root === workspaceRoot;
    case 'plugin':
      return true;
    default:
      // Auto-memory belongs to one project, even though it lives under ~/.claude.
      if (asset.kind === 'memory' && asset.detail?.['Directory']) {
        return workspaceRoot !== undefined && asset.detail['Directory'].includes(projectSlug(workspaceRoot));
      }
      return true;
  }
}

/** Claude Code's project slug: every non-alphanumeric character becomes `-`. */
function projectSlug(root: string): string {
  return `${path.sep}${root.replace(/[^A-Za-z0-9]/g, '-')}${path.sep}`;
}

function memoryRow(asset: Asset): BudgetRow {
  const text = readText(asset.sourcePath) ?? '';
  if (path.basename(asset.sourcePath) === 'MEMORY.md') {
    const head = text.split('\n').slice(0, MEMORY_INDEX_LINES).join('\n');
    return fileRow('Memory', asset, head, `auto-memory index, first ${MEMORY_INDEX_LINES} lines`);
  }
  return fileRow('Memory', asset, text);
}

function skillRow(asset: Asset): BudgetRow | undefined {
  const { data, body } = parseFrontmatter(readText(asset.sourcePath) ?? '');
  if (asText(data['disable-model-invocation']) === 'true') {
    return undefined;
  }
  const listing = [asText(data.description) ?? body.split('\n').find((l) => l.trim()) ?? '', asText(data.when_to_use) ?? '']
    .filter((t) => t !== '')
    .join('\n');
  const row = textRow('Skills', asset, listing.slice(0, SKILL_LISTING_LIMIT));
  if (listing.length > SKILL_LISTING_LIMIT) {
    row.warning = `Listing is ${listing.length} characters; Claude Code truncates it at ${SKILL_LISTING_LIMIT}, so the end is never seen.`;
  }
  return row;
}

function fileRow(category: BudgetRow['category'], asset: Asset, text: string, note?: string): BudgetRow {
  return withWarning({ ...base(category, asset), chars: text.length, tokens: tokens(text.length), note });
}

function textRow(category: BudgetRow['category'], asset: Asset, text: string): BudgetRow {
  return { ...base(category, asset), chars: text.length, tokens: tokens(text.length) };
}

function base(category: BudgetRow['category'], asset: Asset): Pick<BudgetRow, 'category' | 'name' | 'scopeLabel' | 'sourcePath'> {
  return { category, name: asset.invocation ?? asset.name, scopeLabel: asset.scope.label, sourcePath: asset.sourcePath };
}

function withWarning(row: BudgetRow): BudgetRow {
  if (row.tokens > LARGE_FILE_TOKENS) {
    row.warning = `About ${row.tokens.toLocaleString('en-US')} tokens loaded into every session. Consider moving detail into rules with paths: or into skills.`;
  }
  return row;
}

function tokens(chars: number): number {
  return Math.ceil(chars / 4);
}
