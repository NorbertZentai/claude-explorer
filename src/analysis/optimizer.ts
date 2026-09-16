import * as path from 'path';
import { skillKey } from '../discovery/visibility';
import { Asset } from '../discovery/types';
import { BudgetReport, CLAUDE_MD_TARGET_LINES, tokens } from './contextBudget';
import { UsageReport } from './usage';

/**
 * Concrete ways to spend less context at startup, each with the estimated saving and one
 * action that does it or hands Claude a prompt to do it. Heuristics over the budget rows:
 * nothing here is a measurement, and every suggestion says so.
 */

export type SuggestionAction =
  | { type: 'skillVisibility'; state: 'name-only' | 'off' }
  | { type: 'prompt'; label: 'Review and shorten' | 'Split into path-scoped rules' }
  | { type: 'editDescription' };

export interface Suggestion {
  title: string;
  detail: string;
  sourcePath: string;
  /** Estimated tokens saved per session; 0 when it cannot be estimated. */
  saving: number;
  action: SuggestionAction;
  actionLabel: string;
}

const UNUSED_DAYS = 30;
const LONG_LISTING_TOKENS = 250;
const LARGE_RULE_TOKENS = 500;

export function suggestOptimizations(report: BudgetReport, assets: readonly Asset[], usage: UsageReport | undefined, now: number): Suggestion[] {
  const out: Suggestion[] = [];
  const bySource = new Map<string, Asset>();
  for (const a of assets) {
    if (!a.placeholder && !bySource.has(a.sourcePath)) {
      bySource.set(a.sourcePath, a);
    }
  }

  for (const row of report.rows) {
    const asset = bySource.get(row.sourcePath);
    if ((row.category === 'Skills' || row.category === 'Commands') && asset?.toggle?.target === 'skill' && asset.skillOverride !== 'name-only') {
      const nameCost = tokens(skillKey(asset).length);
      const saving = Math.max(0, row.tokens - nameCost);
      if (usage) {
        const used = usage.entries.get(`skill:${skillKey(asset)}`);
        const idle = !used || now - used.lastUsed > UNUSED_DAYS * 86_400_000;
        if (idle && saving >= 20) {
          const days = Math.round((now - usage.since) / 86_400_000);
          out.push({
            title: `${row.name} was ${used ? `last used ${Math.round((now - used.lastUsed) / 86_400_000)} days ago` : `not used in ${days} days`}`,
            detail: `Its listing costs about ${row.tokens} tokens in every session. "name-only" keeps /${skillKey(asset)} available but lists only its name.`,
            sourcePath: row.sourcePath,
            saving,
            action: { type: 'skillVisibility', state: 'name-only' },
            actionLabel: 'Set name-only',
          });
          continue;
        }
      } else if (row.tokens >= LONG_LISTING_TOKENS) {
        out.push({
          title: `${row.name} has a long listing`,
          detail: `About ${row.tokens} tokens in every session. Shorten the description, or set it to name-only if you mostly invoke it yourself.`,
          sourcePath: row.sourcePath,
          saving,
          action: { type: 'skillVisibility', state: 'name-only' },
          actionLabel: 'Set name-only',
        });
      }
    }
    if (row.category === 'Skills' && row.warning?.includes('truncates')) {
      out.push({
        title: `${row.name}: the end of its description is never seen`,
        detail: row.warning,
        sourcePath: row.sourcePath,
        saving: 0,
        action: { type: 'editDescription' },
        actionLabel: 'Edit description',
      });
    }
    if (row.category === 'Memory' && path.basename(row.sourcePath) === 'MEMORY.md' && row.warning) {
      out.push({
        title: 'The auto-memory index is past its load limit',
        detail: row.warning,
        sourcePath: row.sourcePath,
        saving: 0,
        action: { type: 'prompt', label: 'Review and shorten' },
        actionLabel: 'Copy prompt',
      });
    } else if (row.category === 'Memory' && row.lines !== undefined && row.lines > CLAUDE_MD_TARGET_LINES) {
      out.push({
        title: `${path.basename(row.sourcePath)} is ${row.lines} lines`,
        detail: `The docs recommend under ${CLAUDE_MD_TARGET_LINES} lines. Cutting to that would save roughly ${Math.round(row.tokens * (1 - CLAUDE_MD_TARGET_LINES / row.lines))} tokens per session.`,
        sourcePath: row.sourcePath,
        saving: Math.round(row.tokens * (1 - CLAUDE_MD_TARGET_LINES / row.lines)),
        action: { type: 'prompt', label: 'Review and shorten' },
        actionLabel: 'Copy prompt',
      });
    }
    if (row.category === 'Rules' && row.tokens >= LARGE_RULE_TOKENS) {
      out.push({
        title: `${row.name} loads in every session`,
        detail: `About ${row.tokens} tokens with no paths: key. If it only matters for some files, a paths: pattern loads it only then.`,
        sourcePath: row.sourcePath,
        saving: row.tokens,
        action: { type: 'prompt', label: 'Split into path-scoped rules' },
        actionLabel: 'Copy prompt',
      });
    }
  }
  return out.sort((a, b) => b.saving - a.saving);
}
