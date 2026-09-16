import * as path from 'path';
import { findLine, isFile, readJson, readText } from '../util/fs';
import { envVarNames } from '../util/redact';
import { Asset, Scope } from './types';

/**
 * What is inside a settings file, not just the hooks.
 *
 * Claude Code documents roughly 230 top-level keys and the set moves with the CLI, so
 * nothing here validates: an unrecognised key is listed, never flagged as wrong. Only the
 * handful that visibly change behaviour get a row of their own; the rest are summarised on
 * the file's own row so they are still discoverable.
 *
 * `env` values never leave this module -- names only, via redact.ts.
 */

const DOCS = 'https://code.claude.com/docs/en/settings';

interface Permissions {
  allow?: string[];
  deny?: string[];
  ask?: string[];
  defaultMode?: string;
  additionalDirectories?: string[];
}

interface SettingsFile {
  model?: string;
  outputStyle?: string;
  statusLine?: { type?: string; command?: string; padding?: number };
  env?: Record<string, string>;
  permissions?: Permissions;
  [key: string]: unknown;
}

/** The four documented settings files, in precedence order (highest first). */
export function settingsFilesFor(scope: Scope, base: string): string[] {
  if (scope.kind === 'workspace') {
    return [path.join(base, '.claude', 'settings.local.json'), path.join(base, '.claude', 'settings.json')];
  }
  if (scope.kind === 'user') {
    return [path.join(base, 'settings.local.json'), path.join(base, 'settings.json')];
  }
  return [];
}

export function discoverSettings(file: string, scope: Scope): Asset[] {
  if (!isFile(file)) {
    return [];
  }
  const parsed = readJson<SettingsFile>(file);
  if (!parsed) {
    return [
      {
        kind: 'setting',
        name: path.basename(file),
        description: 'could not be parsed',
        scope,
        sourcePath: file,
        docs: DOCS,
        problem: 'Invalid JSON. Claude Code requires strict JSON here — no comments, no trailing commas.',
      },
    ];
  }

  const text = readText(file);
  const out: Asset[] = [];
  const keys = Object.keys(parsed).filter((k) => k !== '$schema');

  out.push({
    kind: 'setting',
    name: path.basename(file),
    description: `${keys.length} key${keys.length === 1 ? '' : 's'}`,
    scope,
    sourcePath: file,
    docs: DOCS,
    detail: {
      Keys: keys.join(', ') || '(empty)',
      Precedence: precedenceNote(file, scope),
    },
  });

  const row = (name: string, description: string, key: string, detail?: Record<string, string>): void => {
    out.push({
      kind: 'setting',
      name,
      description,
      scope,
      sourcePath: file,
      line: findLine(text, `"${key}"`),
      docs: DOCS,
      detail,
    });
  };

  if (typeof parsed.model === 'string') {
    row('model', parsed.model, 'model');
  }
  if (typeof parsed.outputStyle === 'string') {
    row('outputStyle', parsed.outputStyle, 'outputStyle');
  }
  if (parsed.statusLine) {
    row('statusLine', parsed.statusLine.type ?? 'configured', 'statusLine', {
      Type: parsed.statusLine.type ?? '(unset)',
      Command: parsed.statusLine.command ?? '(unset)',
    });
  }

  const envNames = envVarNames(parsed.env);
  if (envNames.length > 0) {
    row(
      'env',
      `${envNames.length} variable${envNames.length === 1 ? '' : 's'}`,
      'env',
      { Variables: envNames.join(', '), Values: 'not shown' },
    );
  }

  const p = parsed.permissions;
  if (p) {
    const counts = [
      p.deny?.length ? `${p.deny.length} deny` : '',
      p.ask?.length ? `${p.ask.length} ask` : '',
      p.allow?.length ? `${p.allow.length} allow` : '',
    ]
      .filter((s) => s !== '')
      .join(' · ');
    row('permissions', counts || 'no rules', 'permissions', {
      // Order matters and is counter-intuitive: an allow rule cannot carve an exception
      // out of a deny rule, because the first match wins.
      Evaluation: 'deny → ask → allow, first match wins',
      Mode: p.defaultMode ?? '(default)',
      'Extra directories': p.additionalDirectories?.join(', ') ?? '(none)',
    });
  }

  return out;
}

/**
 * Decide by SCOPE, not by path. The user file also lives under a `.claude` directory
 * (`~/.claude/settings.json`), so a path test misreports it as a project file.
 */
function precedenceNote(file: string, scope: Scope): string {
  const isLocal = path.basename(file) === 'settings.local.json';
  if (scope.kind === 'workspace') {
    return isLocal
      ? 'project local — overrides the shared project file and the user file'
      : 'shared project — overrides the user file, overridden by settings.local.json';
  }
  return isLocal
    ? 'user local — overridden by every project and managed file'
    : 'user — lowest precedence, overridden by every project and managed file';
}
