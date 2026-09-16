import { asText, parseFrontmatter } from '../discovery/frontmatter';
import { skillKey } from '../discovery/visibility';
import { Asset } from '../discovery/types';
import { readText } from '../util/fs';
import { EffectiveSettings } from './effectiveSettings';
import { lintSkill } from './skillLint';

/**
 * Every documented reason an item might not be in effect in a session, collected in one
 * place: "why doesn't Claude use my skill?" otherwise means checking six files by hand.
 */

export interface Reason {
  /** `blocking`: it will not load or run; `limiting`: it loads, but not the way you might expect. */
  kind: 'blocking' | 'limiting' | 'check';
  text: string;
  sourcePath?: string;
  line?: number;
}

export function whyNotLoaded(asset: Asset, all: readonly Asset[], settings: EffectiveSettings, workspaceRoot: string | undefined): Reason[] {
  const reasons: Reason[] = [];
  const o = asset.overriddenBy;
  if (o && (o.everywhere || (workspaceRoot && o.inRoots?.includes(workspaceRoot)))) {
    reasons.push({ kind: 'blocking', text: `Overridden by ${o.name} in ${o.scopeLabel}: ${o.reason}`, sourcePath: o.sourcePath });
  }
  if (asset.scope.kind === 'workspace' && workspaceRoot && asset.scope.root !== workspaceRoot) {
    reasons.push({ kind: 'blocking', text: `It belongs to ${asset.scope.label}, not to the selected project; sessions only load their own project's configuration.` });
  }
  if (asset.scope.kind === 'plugin') {
    const plugin = all.find((a) => a.kind === 'plugin' && a.scope.root === asset.scope.root);
    if (plugin?.enabled === false) {
      reasons.push({ kind: 'blocking', text: `Its plugin ${plugin.name} is installed but not enabled.`, sourcePath: plugin.sourcePath });
    }
  }
  if (asset.problem) {
    reasons.push({ kind: 'blocking', text: asset.problem, sourcePath: asset.sourcePath, line: asset.line });
  }

  if (asset.kind === 'skill' || asset.kind === 'command') {
    if (asset.skillOverride === 'off') {
      reasons.push({ kind: 'blocking', text: 'skillOverrides sets it to "off": hidden from Claude and from the / menu.', sourcePath: asset.toggle?.file });
    } else if (asset.skillOverride === 'user-invocable-only') {
      reasons.push({ kind: 'limiting', text: 'skillOverrides sets it to "user-invocable-only": you can type it, Claude never loads it by itself.', sourcePath: asset.toggle?.file });
    } else if (asset.skillOverride === 'name-only') {
      reasons.push({ kind: 'limiting', text: 'skillOverrides sets it to "name-only": Claude sees the name without the description, so it rarely picks it.', sourcePath: asset.toggle?.file });
    }
    const { data } = parseFrontmatter(readText(asset.sourcePath) ?? '');
    if (asText(data['disable-model-invocation']) === 'true') {
      reasons.push({ kind: 'limiting', text: 'disable-model-invocation: true, so only you can invoke it; Claude will not load it on its own.', sourcePath: asset.sourcePath });
    }
    if (asText(data['user-invocable']) === 'false') {
      reasons.push({ kind: 'limiting', text: 'user-invocable: false, so it does not appear in the / menu; only Claude can load it.', sourcePath: asset.sourcePath });
    }
    const key = skillKey(asset);
    for (const entry of settings.entries.filter((e) => e.keyPath === 'permissions.deny' || e.keyPath === 'permissions.ask')) {
      const m = /^Skill\((.*)\)$/.exec(entry.value.trim());
      if (entry.value.trim() === 'Skill' || (m && new RegExp(`^${m[1].split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(key)) || (m && m[1].trim().startsWith(`${key} `))) {
        reasons.push({
          kind: entry.keyPath.endsWith('deny') ? 'blocking' : 'limiting',
          text: `${entry.value} in permissions.${entry.keyPath.split('.')[1]} (${entry.source.label}).`,
          sourcePath: entry.source.file,
          line: entry.source.line,
        });
      }
    }
    if (asset.kind === 'skill') {
      for (const f of lintSkill(asset.sourcePath).filter((x) => x.severity === 'warning')) {
        reasons.push({ kind: 'check', text: f.message, sourcePath: asset.sourcePath, line: f.line });
      }
    }
  }

  if (asset.kind === 'rule' && asset.detail?.['Applies to']) {
    reasons.push({ kind: 'limiting', text: `It has paths: ${asset.detail['Applies to']}, so it loads only when Claude reads a matching file.`, sourcePath: asset.sourcePath });
  }
  if ((asset.kind === 'rule' || asset.kind === 'memory') && asset.toggle?.target === 'claudeMd' && asset.enabled === false) {
    reasons.push({ kind: 'blocking', text: 'A claudeMdExcludes pattern matches this file, so it is skipped when memory loads.' });
  }
  if (asset.kind === 'agent') {
    for (const entry of settings.entries.filter((e) => e.keyPath === 'permissions.deny')) {
      if (entry.value.trim() === `Agent(${asset.name})`) {
        reasons.push({ kind: 'blocking', text: `${entry.value} in permissions.deny (${entry.source.label}).`, sourcePath: entry.source.file, line: entry.source.line });
      }
    }
  }
  if (asset.kind === 'hook') {
    const disabled = settings.entries.find((e) => e.keyPath === 'disableAllHooks' && e.status === 'effective' && e.value === 'true');
    if (disabled) {
      reasons.push({ kind: 'blocking', text: `disableAllHooks is true (${disabled.source.label}).`, sourcePath: disabled.source.file, line: disabled.source.line });
    }
  }
  if (asset.kind === 'mcp' && asset.enabled === false) {
    reasons.push({ kind: 'blocking', text: 'Not approved for this project (enabledMcpjsonServers / disabledMcpjsonServers).', sourcePath: asset.toggle?.file });
  }
  return reasons;
}
