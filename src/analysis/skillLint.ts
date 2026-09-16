import * as path from 'path';
import { asText, parseFrontmatter } from '../discovery/frontmatter';
import { isFile, readText } from '../util/fs';

/**
 * A closer look at one SKILL.md than the tree's problem check, against the frontmatter
 * reference at code.claude.com/docs/en/skills. Unknown keys are information, never errors:
 * the format grows with every Claude Code release.
 */

export type Severity = 'warning' | 'info';

export interface Finding {
  severity: Severity;
  message: string;
  /** 0-based line to jump to, when there is one. */
  line?: number;
}

const KNOWN_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent',
  'background', 'hooks', 'paths', 'shell', 'metadata', 'license', 'compatibility',
]);
const BOOLEAN_KEYS = ['disable-model-invocation', 'user-invocable', 'background'];
const BOOLEAN_VALUE = /^(true|false|yes|no|on|off|1|0)$/i;
const TRUE_VALUE = /^(true|yes|on|1)$/i;
const FALSE_VALUE = /^(false|no|off|0)$/i;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const LISTING_LIMIT = 1536;
const COMPATIBILITY_LIMIT = 500;
const RECOMMENDED_LINES = 500;

export function lintSkill(file: string): Finding[] {
  const text = readText(file) ?? '';
  const lines = text.split('\n');
  const findings: Finding[] = [];
  const lineOf = (key: string): number | undefined => {
    const index = lines.findIndex((l) => l.startsWith(`${key}:`));
    return index === -1 ? undefined : index;
  };

  const { data, body, hasFrontmatter } = parseFrontmatter(text);

  if (!hasFrontmatter) {
    const fence = lines.findIndex((l) => l.trim() === '---');
    if (fence > 0) {
      findings.push({
        severity: 'warning',
        message: 'The frontmatter does not start on the first line, so Claude Code ignores it and treats it as content.',
        line: fence,
      });
    }
  }

  const description = asText(data.description);
  if (!description) {
    const fallback = body.split('\n').find((l) => l.trim() !== '');
    findings.push({
      severity: 'warning',
      message: fallback
        ? `No description: Claude uses the first line of the body instead ("${truncate(fallback.trim(), 60)}").`
        : 'No description and no body text: Claude cannot know when to use this skill.',
    });
  }
  const listing = [description ?? '', asText(data.when_to_use) ?? ''].join('\n').trim();
  if (listing.length > LISTING_LIMIT) {
    findings.push({
      severity: 'warning',
      message: `description + when_to_use is ${listing.length} characters; the listing is cut at ${LISTING_LIMIT}, so the end is never seen. Put the key use case first.`,
      line: lineOf('description'),
    });
  }

  for (const key of BOOLEAN_KEYS) {
    const value = asText(data[key]);
    if (value !== undefined && !BOOLEAN_VALUE.test(value)) {
      findings.push({ severity: 'warning', message: `${key}: "${value}" is not a boolean (true/false, yes/no, on/off, 1/0).`, line: lineOf(key) });
    }
  }

  const context = asText(data.context);
  if (context !== undefined && context !== 'fork') {
    findings.push({ severity: 'warning', message: `context: "${context}" has no effect; the only supported value is fork.`, line: lineOf('context') });
  }
  for (const key of ['agent', 'background']) {
    if (data[key] !== undefined && context !== 'fork') {
      findings.push({ severity: 'warning', message: `${key} only applies with context: fork, which is not set.`, line: lineOf(key) });
    }
  }

  const effort = asText(data.effort);
  if (effort !== undefined && !EFFORTS.has(effort)) {
    findings.push({ severity: 'warning', message: `effort: "${effort}" is not one of ${[...EFFORTS].join(', ')}.`, line: lineOf('effort') });
  }
  const shell = asText(data.shell);
  if (shell !== undefined && shell !== 'bash' && shell !== 'powershell') {
    findings.push({ severity: 'warning', message: `shell: "${shell}" must be bash or powershell.`, line: lineOf('shell') });
  }
  const compatibility = asText(data.compatibility);
  if (compatibility !== undefined && compatibility.length > COMPATIBILITY_LIMIT) {
    findings.push({ severity: 'warning', message: `compatibility is ${compatibility.length} characters; the limit is ${COMPATIBILITY_LIMIT}.`, line: lineOf('compatibility') });
  }
  if (typeof data.metadata === 'string' && data.metadata.trim() !== '') {
    findings.push({ severity: 'warning', message: 'metadata must be a map of keys; Claude Code drops any other value.', line: lineOf('metadata') });
  }

  // Relative links to supporting files that are not there.
  const dir = path.dirname(file);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith('/')) {
        continue;
      }
      if (!isFile(path.join(dir, decodeURIComponent(target))) && !isFile(path.join(dir, target))) {
        findings.push({ severity: 'warning', message: `Links to ${target}, which does not exist next to SKILL.md.`, line: index });
      }
    }
  });

  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) {
      findings.push({ severity: 'info', message: `Unknown frontmatter key "${key}". It may be newer than this extension, or a typo.`, line: lineOf(key) });
    }
  }

  const name = asText(data.name);
  const folder = path.basename(dir);
  if (name !== undefined && name !== folder) {
    findings.push({
      severity: 'info',
      message: `name is "${name}" but the folder is "${folder}". You invoke it as /${folder}; name is only the label in listings (plugin skills are the exception).`,
      line: lineOf('name'),
    });
  }
  if (lines.length > RECOMMENDED_LINES) {
    findings.push({ severity: 'info', message: `SKILL.md is ${lines.length} lines; the docs suggest under ${RECOMMENDED_LINES} and moving detail into linked files.` });
  }
  const noModel = TRUE_VALUE.test(asText(data['disable-model-invocation']) ?? '');
  const noUser = FALSE_VALUE.test(asText(data['user-invocable']) ?? '');
  if (noModel && noUser) {
    findings.push({ severity: 'info', message: 'disable-model-invocation is on and user-invocable is off, so neither Claude nor you can invoke this skill.' });
  }

  return findings;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
