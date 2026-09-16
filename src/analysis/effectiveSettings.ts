import * as path from 'path';
import { userClaudeDir } from '../discovery/scopes';
import { managedSettingsDir } from '../discovery/system';
import { envVarNames, redactValue } from '../util/redact';
import { filesWithExtension, findLine, isFile, readJson, readText } from '../util/fs';

/**
 * The settings a Claude Code session in one project actually runs with, and where each
 * value came from. Precedence and merge rules are from code.claude.com/docs/en/settings:
 *
 *   managed > project local > shared project > user local > user
 *
 *   - a scalar comes from the highest file that sets it; lower ones are overridden
 *   - lists such as `permissions.allow` are combined, not replaced
 *   - objects merge key by key
 *   - `fallbackModel` is an ordered chain and is taken whole from the highest file;
 *     `modelPicker`, `availableModels` and `modelSettings` follow their own rules, so they
 *     are shown with a note rather than resolved here
 *
 * `hooks` belong to the hook timeline, and `env` shows variable names only.
 */

export interface SettingsLayer {
  label: string;
  file: string;
  exists: boolean;
  /** False when the file exists but is not strict JSON, so it contributes nothing. */
  valid: boolean;
}

export type EntryStatus = 'effective' | 'overridden' | 'merged' | 'duplicate';

export interface EffectiveEntry {
  keyPath: string;
  /** Already redacted; safe to render. */
  value: string;
  status: EntryStatus;
  source: { label: string; file: string; line?: number };
  note?: string;
}

export interface EffectiveSettings {
  layers: SettingsLayer[];
  entries: EffectiveEntry[];
  notes: string[];
}

interface Leaf {
  keyPath: string;
  value: unknown;
  /** One item of a list, which merges instead of overriding. */
  item: boolean;
  layer: number;
  label: string;
  file: string;
  text: string;
}

const SKIPPED = new Set(['$schema', 'hooks']);
const WHOLE_VALUE = new Set(['fallbackModel']);
const SPECIAL = new Set(['modelPicker', 'availableModels', 'modelSettings']);

export function effectiveSettings(workspaceRoot: string | undefined): EffectiveSettings {
  const claudeDir = userClaudeDir();
  const managedDir = managedSettingsDir();

  // Highest precedence first. Managed drop-ins merge after the main file, alphabetically,
  // so the last drop-in is the strongest of the managed files.
  const files: Array<[string, string]> = [
    ...filesWithExtension(path.join(managedDir, 'managed-settings.d'), '.json')
      .sort()
      .reverse()
      .map((f): [string, string] => [`managed · ${path.basename(f)}`, f]),
    ['managed', path.join(managedDir, 'managed-settings.json')],
  ];
  if (workspaceRoot) {
    files.push(
      ['project local', path.join(workspaceRoot, '.claude', 'settings.local.json')],
      ['project', path.join(workspaceRoot, '.claude', 'settings.json')],
    );
  }
  files.push(
    ['user local', path.join(claudeDir, 'settings.local.json')],
    ['user', path.join(claudeDir, 'settings.json')],
  );

  const layers: SettingsLayer[] = [];
  const leaves: Leaf[] = [];

  files.forEach(([label, file], layer) => {
    const exists = isFile(file);
    const parsed = exists ? readJson<unknown>(file) : undefined;
    const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    layers.push({ label, file, exists, valid: !exists || isObject });
    if (!isObject) {
      return;
    }
    const text = readText(file) ?? '';
    const push = (keyPath: string, value: unknown, item: boolean): void => {
      leaves.push({ keyPath, value, item, layer, label, file, text });
    };
    const visit = (value: unknown, keyPath: string): void => {
      const top = keyPath.split('.')[0];
      if (keyPath === 'env') {
        for (const name of envVarNames(value)) {
          push(`env.${name}`, undefined, false);
        }
        return;
      }
      if (SPECIAL.has(top) || WHOLE_VALUE.has(top)) {
        push(keyPath, value, false);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          push(keyPath, item, true);
        }
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          visit(child, `${keyPath}.${key}`);
        }
        return;
      }
      push(keyPath, value, false);
    };
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!SKIPPED.has(key)) {
        visit(value, key);
      }
    }
  });

  const entries: EffectiveEntry[] = [];
  const decided = new Set<string>();
  const seenItems = new Set<string>();

  for (const leaf of leaves) {
    const last = leaf.keyPath.split('.').pop() ?? leaf.keyPath;
    const top = leaf.keyPath.split('.')[0];
    let status: EntryStatus;
    if (leaf.item) {
      const id = `${leaf.keyPath} => ${JSON.stringify(leaf.value)}`;
      status = seenItems.has(id) ? 'duplicate' : 'merged';
      seenItems.add(id);
    } else if (decided.has(leaf.keyPath)) {
      status = 'overridden';
    } else {
      decided.add(leaf.keyPath);
      status = 'effective';
    }

    entries.push({
      keyPath: leaf.keyPath,
      value: displayValue(leaf.keyPath, last, leaf.value),
      status,
      source: {
        label: leaf.label,
        file: leaf.file,
        line: findLine(leaf.text, leaf.item && typeof leaf.value === 'string' ? `"${leaf.value}"` : `"${last}"`),
      },
      note: SPECIAL.has(top)
        ? 'Resolved by its own rules (see the settings docs); shown as written.'
        : WHOLE_VALUE.has(top)
          ? 'An ordered chain: taken whole from the highest file that sets it.'
          : status === 'duplicate'
            ? 'Also listed in a higher-precedence file.'
            : undefined,
    });
  }

  // Stable sort: within one key, higher-precedence files stay first.
  entries.sort((a, b) => a.keyPath.localeCompare(b.keyPath));

  const notes: string[] = [];
  if (isFile(path.join(claudeDir, 'remote-settings.json'))) {
    notes.push(
      'Your organization also pushes remote-settings.json; how it combines with managed files is decided by Claude Code and not shown here.',
    );
  }
  notes.push('Settings passed with `claude --settings` for a single session are not visible here.');
  const invalid = layers.filter((l) => !l.valid);
  if (invalid.length > 0) {
    notes.push(`Ignored because it is not valid JSON: ${invalid.map((l) => l.file).join(', ')}`);
  }
  return { layers, entries, notes };
}

function displayValue(keyPath: string, last: string, value: unknown): string {
  if (keyPath.startsWith('env.')) {
    return '(value not shown)';
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(last, v)).join(', ');
  }
  return redactValue(last, value);
}
