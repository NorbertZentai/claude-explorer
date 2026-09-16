import * as fs from 'fs';
import * as path from 'path';
import { Collection } from '../discovery';
import { userClaudeDir } from '../discovery/scopes';
import { SURFACES } from '../discovery/surfaces';
import { isDir, isFile } from '../util/fs';
import { HookIdentity } from '../edit/hookText';

/**
 * Leftovers that can go: hooks whose script is gone, approvals for MCP servers that no
 * longer exist, plans past Claude Code's cleanup window, empty surface folders, skill
 * folders without a SKILL.md, and broken symlinks. Only the user's own scopes are looked at;
 * plugin and managed files are not ours to tidy.
 *
 * Every candidate says what removing it does. Nothing here deletes anything.
 */

export type CleanupAction =
  | { type: 'trash'; path: string }
  | { type: 'removeHook'; file: string; hook: HookIdentity }
  | { type: 'removeListItem'; file: string; key: string; value: string };

export interface CleanupCandidate {
  category: 'Missing hook script' | 'Stale MCP approval' | 'Expired plan' | 'Empty folder' | 'Skill folder without SKILL.md' | 'Broken symlink';
  label: string;
  reason: string;
  scopeLabel: string;
  action: CleanupAction;
  /** Safe enough to tick by default. Anything that might be work in progress is not. */
  preselected: boolean;
}

const IGNORABLE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function findCleanupCandidates(collection: Collection): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];

  for (const asset of collection.assets) {
    if (asset.placeholder || (asset.scope.kind !== 'user' && asset.scope.kind !== 'workspace')) {
      continue;
    }
    if (asset.kind === 'hook' && asset.hook && asset.problem?.startsWith('Script not found') && asset.sourcePath.endsWith('.json')) {
      out.push({
        category: 'Missing hook script',
        label: `${asset.hook.event}${asset.hook.matcher ? ` · ${asset.hook.matcher}` : ''}`,
        reason: `${asset.problem} Removes the hook entry from ${path.basename(asset.sourcePath)}.`,
        scopeLabel: asset.scope.label,
        action: { type: 'removeHook', file: asset.sourcePath, hook: { event: asset.hook.event, matcher: asset.hook.matcher, command: asset.hook.command } },
        preselected: true,
      });
    }
    if (asset.kind === 'mcp' && asset.problem?.startsWith('Stale approval')) {
      out.push({
        category: 'Stale MCP approval',
        label: asset.name,
        reason: `No server named ${asset.name} in .mcp.json. Removes it from enabledMcpjsonServers.`,
        scopeLabel: asset.scope.label,
        action: { type: 'removeListItem', file: asset.sourcePath, key: 'enabledMcpjsonServers', value: asset.name },
        preselected: true,
      });
    }
    if (asset.kind === 'plan' && asset.problem?.startsWith('Past the cleanup window')) {
      out.push({
        category: 'Expired plan',
        label: asset.name,
        reason: 'Older than cleanupPeriodDays; Claude Code may delete it anyway. Moves it to the Trash.',
        scopeLabel: asset.scope.label,
        action: { type: 'trash', path: asset.sourcePath },
        preselected: false,
      });
    }
  }

  const bases: Array<{ scope: 'user' | 'workspace'; base: string; label: string }> = [
    { scope: 'user', base: userClaudeDir(), label: 'user' },
    ...collection.scopes.filter((s) => s.kind === 'workspace' && s.hasConfigDir !== false).map((s) => ({ scope: 'workspace' as const, base: s.root, label: s.label })),
  ];
  const seenDirs = new Set<string>();
  for (const { scope, base, label } of bases) {
    for (const surface of SURFACES) {
      for (const loc of surface.locations.filter((l) => l.scope === scope && l.type === 'dir')) {
        const dir = path.join(base, loc.rel);
        if (seenDirs.has(dir) || !isDir(dir)) {
          continue;
        }
        seenDirs.add(dir);
        const entries = safeReaddir(dir);
        if (entries.filter((e) => !IGNORABLE.has(e)).length === 0) {
          out.push({
            category: 'Empty folder',
            label: path.join(scope === 'user' ? '~/.claude' : label, loc.rel),
            reason: 'Nothing in it. Claude Code does not need the folder to exist. Moves it to the Trash.',
            scopeLabel: label,
            action: { type: 'trash', path: dir },
            preselected: true,
          });
          continue;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry);
          if (isBrokenSymlink(full)) {
            out.push({
              category: 'Broken symlink',
              label: path.join(loc.rel, entry),
              reason: `Points to ${safeReadlink(full)}, which does not exist. Removes the link only.`,
              scopeLabel: label,
              action: { type: 'trash', path: full },
              preselected: true,
            });
            continue;
          }
          if (surface.kind === 'skill' && isDir(full) && !isFile(path.join(full, 'SKILL.md')) && !entry.startsWith('.')) {
            const inside = safeReaddir(full).filter((e) => !IGNORABLE.has(e));
            out.push({
              category: 'Skill folder without SKILL.md',
              label: path.join(loc.rel, entry),
              reason: `Claude Code ignores a skill folder without SKILL.md${inside.length > 0 ? ` (it holds ${inside.length} other item${inside.length === 1 ? '' : 's'})` : ' (it is empty)'}. Moves the folder to the Trash.`,
              scopeLabel: label,
              action: { type: 'trash', path: full },
              preselected: inside.length === 0,
            });
          }
        }
      }
    }
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isBrokenSymlink(target: string): boolean {
  try {
    if (!fs.lstatSync(target).isSymbolicLink()) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    fs.statSync(target);
    return false;
  } catch {
    return true;
  }
}

function safeReadlink(target: string): string {
  try {
    return fs.readlinkSync(target);
  } catch {
    return 'a missing target';
  }
}
