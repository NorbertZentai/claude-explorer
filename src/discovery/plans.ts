import * as path from 'path';
import { filesWithExtension, mtime, readText } from '../util/fs';
import { Asset, Scope } from './types';

/**
 * Plans, which are two unrelated things wearing the same name.
 *
 * `~/.claude/plans/` is Claude Code's own store: plan mode writes a file there before
 * calling ExitPlanMode, the file is re-injected from disk after each compaction, and the
 * names are generated from your first prompt plus two random words. It is a flat,
 * cross-project scratch directory.
 *
 * `<project>/.claude/plans/` is NOT a Claude Code location. Nothing in the official docs
 * reads it; it only becomes real to Claude Code if `plansDirectory` points there. Where it
 * exists it is a team convention -- here, the numbered `NNNN-Title.plan.md` design
 * documents this workspace's CLAUDE.md defines.
 *
 * Treating them as one row under "Memory" hid both.
 */

const DOCS = 'https://code.claude.com/docs/en/permission-modes';

/**
 * Claude Code deletes files under `~/.claude/` older than `cleanupPeriodDays` (default
 * 30). Plan mode's store is on that list, so a plan worth keeping has a shelf life -- and
 * nothing warns you. Project plan directories are outside `~/.claude/` and are not touched.
 */
const DEFAULT_CLEANUP_DAYS = 30;
const WARN_WITHIN_DAYS = 7;

export function discoverUserPlans(claudeDir: string, scope: Scope, cleanupDays?: number): Asset[] {
  const dir = path.join(claudeDir, 'plans');
  const days = cleanupDays ?? DEFAULT_CLEANUP_DAYS;

  const assets = filesWithExtension(dir, '.md').map((file) => {
    const modified = mtime(file);
    const age = modified === undefined ? undefined : Math.floor((Date.now() - modified) / 86_400_000);
    const left = age === undefined ? undefined : days - age;

    const asset: Asset = {
      kind: 'plan',
      name: titleOf(file),
      description: path.basename(file),
      scope,
      sourcePath: file,
      docs: DOCS,
      detail: {
        Store: 'Claude Code plan mode (written automatically)',
        File: path.basename(file),
        'Auto-deleted after': `${days} days (cleanupPeriodDays)`,
      },
    };

    if (left !== undefined) {
      asset.detail!['Expires'] = left <= 0 ? 'overdue — may be deleted on the next cleanup' : `in ${left} day${left === 1 ? '' : 's'}`;
      if (left <= WARN_WITHIN_DAYS) {
        asset.problem =
          left <= 0
            ? 'Past the cleanup window — Claude Code may delete this file. Copy it somewhere permanent if you still want it.'
            : `Claude Code deletes this in ${left} day${left === 1 ? '' : 's'} (cleanupPeriodDays). Copy it out if it still matters.`;
      }
    }
    return asset;
  });

  // Newest first: for a scratch store, recency is the only ordering that means anything.
  return assets.sort((a, b) => (b.modified ?? mtimeOf(b)) - (a.modified ?? mtimeOf(a)));
}

export function discoverProjectPlans(claudeDir: string, scope: Scope): Asset[] {
  const dir = path.join(claudeDir, 'plans');
  // Filename order, because the NNNN prefix is the ordering the convention intends.
  return filesWithExtension(dir, '.md').map((file) => ({
    kind: 'plan' as const,
    name: titleOf(file),
    description: path.basename(file),
    scope,
    sourcePath: file,
    docs: DOCS,
    detail: {
      Store: 'project convention (not a Claude Code location)',
      File: path.basename(file),
      Note: 'Claude Code only writes here if plansDirectory points at it.',
    },
  }));
}

/**
 * The filenames are slugs; the content is not. Every plan starts with an `# ` heading, so
 * reading it turns an opaque list into a browsable index. Falls back to the filename.
 */
function titleOf(file: string): string {
  const text = readText(file);
  if (text) {
    for (const line of text.replace(/\r\n/g, '\n').split('\n', 40)) {
      const m = /^#\s+(.+?)\s*$/.exec(line);
      if (m) {
        return m[1].length > 90 ? `${m[1].slice(0, 87)}…` : m[1];
      }
    }
  }
  return path.basename(file, '.md');
}

function mtimeOf(asset: Asset): number {
  return mtime(asset.sourcePath) ?? 0;
}
