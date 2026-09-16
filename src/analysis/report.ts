import * as path from 'path';
import { Asset, ASSET_LABELS, ASSET_ORDER, Scope, ScopeKind } from '../discovery/types';
import { redactCommandLine } from '../util/redact';
import { effectiveSettings } from './effectiveSettings';

/**
 * A Markdown summary of one scope's Claude Code configuration, for onboarding notes, PR
 * descriptions or bug reports. Built only from already-redacted asset fields plus the
 * redacted effective settings, so it can be pasted anywhere.
 */

export interface ReportTarget {
  kind: ScopeKind;
  /** One project or plugin; undefined covers every scope of that kind. */
  root?: string;
}

export function renderReport(
  assets: readonly Asset[],
  scopes: readonly Scope[],
  target: ReportTarget,
  generatedAt: Date,
): string {
  const inTarget = assets.filter(
    (a) => !a.placeholder && a.scope.kind === target.kind && (target.root === undefined || a.scope.root === target.root),
  );
  const scope = target.root ? scopes.find((s) => s.root === target.root) : undefined;
  const title = scope ? `${scope.label} (${target.kind})` : KIND_TITLES[target.kind];
  const base = target.root;
  const rel = (file: string): string => {
    const relative = base ? path.relative(base, file) : '';
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
  };

  const out: string[] = [
    `# Claude Code configuration: ${cell(title)}`,
    '',
    `Generated ${generatedAt.toISOString().slice(0, 10)} by Explorer for Claude Code.${base ? ` Paths are relative to \`${base}\`.` : ''}`,
    '',
  ];

  if (inTarget.length === 0) {
    out.push('_Nothing configured here._', '');
  }

  for (const kind of ASSET_ORDER) {
    const list = inTarget.filter((a) => a.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) {
      continue;
    }
    out.push(`## ${ASSET_LABELS[kind]} (${list.length})`, '');
    if (kind === 'hook') {
      out.push('| Event | Matcher | Command | Declared in |', '|---|---|---|---|');
      for (const a of list) {
        out.push(
          `| ${cell(a.hook?.event ?? '')} | ${cell(a.hook?.matcher ?? '*')} | \`${cell(redactCommandLine((a.hook?.command ?? '').split(/\s+/)))}\` | ${cell(rel(a.sourcePath))} |`,
        );
      }
    } else if (kind === 'mcp') {
      out.push('| Server | Transport | State | Environment | File |', '|---|---|---|---|---|');
      for (const a of list) {
        out.push(
          `| ${cell(a.name)} | ${cell(a.detail?.['Transport'] ?? '')} | ${a.enabled === false ? 'not approved' : 'active'} | ${cell(a.detail?.['Environment'] ?? '')} | ${cell(rel(a.sourcePath))} |`,
        );
      }
    } else {
      out.push('| Name | Description | File |', '|---|---|---|');
      for (const a of list) {
        out.push(`| ${cell(a.invocation ?? a.name)} | ${cell(truncate(a.description ?? '', 120))} | ${cell(rel(a.sourcePath))} |`);
      }
    }
    out.push('');
  }

  if (target.kind === 'workspace' && target.root) {
    const settings = effectiveSettings(target.root).entries.filter((e) => e.status !== 'overridden');
    if (settings.length > 0) {
      out.push('## Effective settings in this project', '', '| Key | Value | From |', '|---|---|---|');
      for (const e of settings) {
        out.push(`| \`${cell(e.keyPath)}\` | ${cell(e.value)} | ${cell(e.source.label)} |`);
      }
      out.push('');
    }
  }

  const overridden = inTarget.filter((a) => a.overriddenBy);
  if (overridden.length > 0) {
    out.push('## Overridden', '');
    for (const a of overridden) {
      out.push(`- **${cell(a.invocation ?? a.name)}** loses to ${cell(a.overriddenBy!.name)} (${cell(a.overriddenBy!.scopeLabel)}). ${a.overriddenBy!.reason}`);
    }
    out.push('');
  }

  const problems = inTarget.filter((a) => a.problem);
  out.push(`## Problems (${problems.length})`, '');
  out.push(...(problems.length > 0 ? problems.map((a) => `- **${cell(a.name)}** (${ASSET_LABELS[a.kind]}): ${a.problem}`) : ['None found.']));
  out.push('', '---', '_Values of environment variables and credentials are never included._', '');
  return out.join('\n');
}

const KIND_TITLES: Record<ScopeKind, string> = {
  system: 'System',
  user: 'User',
  plugin: 'Plugins',
  workspace: 'Workspace',
};

/** Keep a value inside one Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
