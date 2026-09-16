import * as path from 'path';
import { filesWithExtension, readJson } from '../util/fs';
import { matchesPathGlob } from '../util/glob';
import { managedSettingsDir } from './system';
import { Asset, SkillOverride } from './types';

/**
 * The two documented settings that switch configuration off without deleting it:
 *
 *   skillOverrides     { "<skill>": "on" | "name-only" | "user-invocable-only" | "off" }
 *                      any settings file; the highest-precedence file that names a skill
 *                      decides; plugin skills are not affected (code.claude.com/docs/en/skills)
 *   claudeMdExcludes   [ "<glob on absolute paths>" ] in any settings file; lists merge
 *                      across files; managed CLAUDE.md cannot be excluded (…/memory)
 *
 * Each user or project skill, command, CLAUDE.md and rule gets its current state and a
 * toggle that writes the switch into the most personal file for its scope: the project's
 * `.claude/settings.local.json`, or `~/.claude/settings.json` for user items.
 */

const STATES = new Set<SkillOverride>(['on', 'name-only', 'user-invocable-only', 'off']);

export function applyVisibility(assets: Asset[], claudeDir: string): void {
  const cache = new Map<string, Record<string, unknown> | undefined>();
  const read = (file: string): Record<string, unknown> | undefined => {
    if (!cache.has(file)) {
      const parsed = readJson<unknown>(file);
      cache.set(file, parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined);
    }
    return cache.get(file);
  };

  const managedDir = managedSettingsDir();
  const managed = [
    ...filesWithExtension(path.join(managedDir, 'managed-settings.d'), '.json').sort().reverse(),
    path.join(managedDir, 'managed-settings.json'),
  ];
  const user = [path.join(claudeDir, 'settings.local.json'), path.join(claudeDir, 'settings.json')];

  for (const asset of assets) {
    if (asset.placeholder || (asset.scope.kind !== 'user' && asset.scope.kind !== 'workspace')) {
      continue;
    }
    const project =
      asset.scope.kind === 'workspace'
        ? [path.join(asset.scope.root, '.claude', 'settings.local.json'), path.join(asset.scope.root, '.claude', 'settings.json')]
        : [];
    const layers = [...managed, ...project, ...user];
    const target =
      asset.scope.kind === 'workspace' ? project[0] : path.join(claudeDir, 'settings.json');

    if (asset.kind === 'skill' || asset.kind === 'command') {
      const key = skillKey(asset);
      for (const file of layers) {
        const overrides = read(file)?.skillOverrides;
        const value = overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>)[key] : undefined;
        if (typeof value === 'string' && STATES.has(value as SkillOverride)) {
          if (value !== 'on') {
            asset.skillOverride = value as SkillOverride;
          }
          break;
        }
      }
      asset.enabled = asset.skillOverride !== 'off';
      asset.toggle = { file: target, target: 'skill', key };
      continue;
    }

    const autoMemory = asset.kind === 'memory' && asset.detail?.['Directory'] !== undefined;
    if ((asset.kind === 'memory' && !autoMemory) || asset.kind === 'rule') {
      const patterns = layers.flatMap((file) => {
        const list = read(file)?.claudeMdExcludes;
        return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
      });
      asset.enabled = !patterns.some((pattern) => matchesPathGlob(pattern, asset.sourcePath));
      asset.toggle = { file: target, target: 'claudeMd', key: asset.sourcePath };
    }
  }
}

/** What `skillOverrides` is keyed by: the name you type, from the folder or file name. */
export function skillKey(asset: Pick<Asset, 'kind' | 'sourcePath'>): string {
  return asset.kind === 'skill'
    ? path.basename(path.dirname(asset.sourcePath))
    : path.basename(asset.sourcePath, '.md');
}
