import * as path from 'path';
import { asText, parseFrontmatter } from '../discovery/frontmatter';
import { expandImports, stripBlockComments } from '../discovery/imports';
import { inheritedFrom } from '../discovery/scopes';
import { Asset } from '../discovery/types';
import { readText } from '../util/fs';

/**
 * A rough estimate of how much context a Claude Code session in one project spends on
 * configuration before the first prompt. Always labelled an estimate: tokens are taken as
 * characters / 4, which is close for English prose and wrong for everything else.
 *
 * What loads at startup, per code.claude.com/docs:
 *   - every CLAUDE.md in full: user, project, .claude/, CLAUDE.local.md, and ancestors,
 *     plus the files they `@import` (up to four hops), minus block-level HTML comments
 *   - the first 200 lines or 25 KB of the auto-memory MEMORY.md index, whichever is first
 *   - rules without a `paths:` key (rules with one load only when a matching file is read)
 *   - skill listings: `description` + `when_to_use`, truncated at 1,536 characters,
 *     unless `disable-model-invocation` or `skillOverrides` keeps the skill out of the
 *     listing (`name-only` leaves just the name)
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
  /** Line count of a memory or rule file, for the length suggestions. */
  lines?: number;
}

export interface BudgetReport {
  rows: BudgetRow[];
  totalTokens: number;
  /** Things that do cost context but cannot be measured from files. */
  unmeasured: string[];
}

export const SKILL_LISTING_LIMIT = 1536;
const MEMORY_INDEX_LINES = 200;
const MEMORY_INDEX_BYTES = 25 * 1024;
/** The documented target for one CLAUDE.md. */
export const CLAUDE_MD_TARGET_LINES = 200;
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
  const counted = new Set<string>();

  const addImports = (asset: Pick<Asset, 'sourcePath' | 'scope'>, scopeLabel: string): void => {
    for (const imported of expandImports(asset.sourcePath)) {
      if (counted.has(imported.file)) {
        continue;
      }
      counted.add(imported.file);
      const text = stripBlockComments(readText(imported.file) ?? '');
      rows.push(
        withWarning({
          category: 'Memory',
          name: path.basename(imported.file),
          scopeLabel,
          sourcePath: imported.file,
          chars: text.length,
          tokens: tokens(text.length),
          note: `imported by ${path.basename(imported.importedBy)}`,
        }),
      );
    }
  };

  for (const asset of inSession) {
    switch (asset.kind) {
      case 'memory': {
        const row = memoryRow(asset);
        counted.add(asset.sourcePath);
        rows.push(row);
        if (path.basename(asset.sourcePath) !== 'MEMORY.md') {
          addImports(asset, asset.scope.label);
        }
        break;
      }
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
      case 'command': {
        const listing = listingText(asset);
        if (listing !== undefined) {
          rows.push(textRow('Commands', asset, listing));
        }
        break;
      }
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
      const text = stripBlockComments(readText(file) ?? '');
      counted.add(file);
      rows.push(
        withWarning({
          category: 'Memory',
          name: file,
          scopeLabel: 'parent folder',
          sourcePath: file,
          chars: text.length,
          tokens: tokens(text.length),
          lines: lineCount(text),
          note: 'inherited from a parent folder',
        }),
      );
      addImports({ sourcePath: file, scope: { kind: 'workspace', label: 'parent folder', root: path.dirname(file) } }, 'parent folder');
    }
  }

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

export interface AssetTokens {
  /** What loads before the first prompt, wherever this asset applies. */
  startup: number;
  /** The whole file, which is what a skill, command, subagent or scoped rule costs once used. */
  full: number;
}

/**
 * Per-asset cost for tooltips, independent of any one project: the same rules as the
 * budget, applied to a single row. Undefined for kinds that cost nothing measurable.
 */
export function assetTokens(asset: Asset): AssetTokens | undefined {
  if (asset.placeholder) {
    return undefined;
  }
  const raw = readText(asset.sourcePath);
  if (raw === undefined) {
    return undefined;
  }
  const full = tokens(raw.length);
  switch (asset.kind) {
    case 'memory':
      return { startup: asset.enabled === false ? 0 : memoryRow(asset).tokens, full };
    case 'rule':
      return { startup: asset.detail?.['Applies to'] || asset.enabled === false ? 0 : full, full };
    case 'skill':
      return { startup: skillRow(asset)?.tokens ?? 0, full };
    case 'command': {
      const listing = listingText(asset);
      return { startup: listing === undefined ? 0 : tokens(listing.length), full };
    }
    case 'agent': {
      const { data } = parseFrontmatter(raw);
      return { startup: tokens((asText(data.description) ?? '').length), full };
    }
    default:
      return undefined;
  }
}

/** User, system and enabled plugins apply everywhere; a project only to itself. */
function appliesTo(asset: Asset, workspaceRoot: string | undefined): boolean {
  if (asset.overriddenBy?.everywhere || (workspaceRoot && asset.overriddenBy?.inRoots?.includes(workspaceRoot))) {
    return false;
  }
  // claudeMdExcludes and skillOverrides "off" both keep a file out of the session.
  if (asset.enabled === false && (asset.kind === 'memory' || asset.kind === 'rule')) {
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
    let head = text.split('\n').slice(0, MEMORY_INDEX_LINES).join('\n');
    let note = `auto-memory index, first ${MEMORY_INDEX_LINES} lines`;
    if (Buffer.byteLength(head, 'utf8') > MEMORY_INDEX_BYTES) {
      head = Buffer.from(head, 'utf8').subarray(0, MEMORY_INDEX_BYTES).toString('utf8');
      note = 'auto-memory index, first 25 KB';
    }
    const row = fileRow('Memory', asset, head, note);
    const totalLines = lineCount(text);
    if (totalLines > MEMORY_INDEX_LINES || Buffer.byteLength(text, 'utf8') > MEMORY_INDEX_BYTES) {
      row.warning = `The index is ${totalLines} lines (${Math.round(Buffer.byteLength(text, 'utf8') / 1024)} KB). Only the first ${MEMORY_INDEX_LINES} lines or 25 KB load; the rest is never seen.`;
    }
    return row;
  }
  const visible = stripBlockComments(text);
  const row = fileRow('Memory', asset, visible, visible.length < text.length ? 'HTML comments not counted' : undefined);
  row.lines = lineCount(visible);
  if (!row.warning && row.lines > CLAUDE_MD_TARGET_LINES) {
    row.warning = `${row.lines} lines. The docs recommend under ${CLAUDE_MD_TARGET_LINES} per CLAUDE.md; longer files cost context and are followed less reliably.`;
  }
  return row;
}

/** What a skill or command puts into the listing, or undefined when it is kept out. */
function listingText(asset: Asset): string | undefined {
  const { data, body } = parseFrontmatter(readText(asset.sourcePath) ?? '');
  if (asText(data['disable-model-invocation']) === 'true') {
    return undefined;
  }
  switch (asset.skillOverride) {
    case 'off':
    case 'user-invocable-only':
      return undefined;
    case 'name-only':
      return asset.name;
  }
  if (asset.kind === 'command') {
    return asset.description ?? '';
  }
  return [asText(data.description) ?? body.split('\n').find((l) => l.trim()) ?? '', asText(data.when_to_use) ?? '']
    .filter((t) => t !== '')
    .join('\n');
}

function skillRow(asset: Asset): BudgetRow | undefined {
  const listing = listingText(asset);
  if (listing === undefined) {
    return undefined;
  }
  const row = textRow('Skills', asset, listing.slice(0, SKILL_LISTING_LIMIT));
  if (asset.skillOverride === 'name-only') {
    row.note = 'name only (skillOverrides)';
  }
  if (listing.length > SKILL_LISTING_LIMIT) {
    row.warning = `Listing is ${listing.length} characters; Claude Code truncates it at ${SKILL_LISTING_LIMIT}, so the end is never seen.`;
  }
  return row;
}

function fileRow(category: BudgetRow['category'], asset: Asset, text: string, note?: string): BudgetRow {
  return withWarning({ ...base(category, asset), chars: text.length, tokens: tokens(text.length), lines: lineCount(text), note });
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

function lineCount(text: string): number {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

export function tokens(chars: number): number {
  return Math.ceil(chars / 4);
}
