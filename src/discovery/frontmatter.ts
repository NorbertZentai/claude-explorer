/**
 * A tolerant reader for the YAML frontmatter Claude Code assets use.
 *
 * Deliberately not a YAML library. Every shape below was found on this machine, and a
 * naive line-splitter breaks on at least three of them:
 *
 *   name: doc-study                          plain scalar
 *   description: "Triggers on: 'x', 'y'"     quoted, because the value contains a colon
 *   tools: Read, Grep, Glob                  comma string
 *   tools: ["Read", "Grep"]                  JSON array -- same key, different syntax
 *   model: inherit
 *   description: |                           block scalar, 30+ lines, containing
 *     Use this agent when...                 <example> blocks whose angle brackets and
 *     <example>                              colons look like YAML but are not
 *     user: "..."
 *     </example>
 *
 * Files with no frontmatter at all are normal -- the user's own `doc.md` and `pr.md`
 * slash commands have none, and their first line is the description.
 */

export type FrontmatterValue = string | string[];
export interface Frontmatter {
  [key: string]: FrontmatterValue;
}

export interface ParsedDocument {
  data: Frontmatter;
  body: string;
  /** False when the file had no `---` block, so callers can fall back to the first line. */
  hasFrontmatter: boolean;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/;
const LIST_ITEM = /^\s*-\s+(.*)$/;
const BLOCK_SCALAR = /^[|>][-+]?\s*$/;

export function parseFrontmatter(text: string): ParsedDocument {
  const normalised = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const lines = normalised.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { data: {}, body: normalised, hasFrontmatter: false };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    // An opening fence with no close is malformed; treat the whole file as body
    // rather than silently swallowing it.
    return { data: {}, body: normalised, hasFrontmatter: false };
  }

  const data: Frontmatter = {};
  let i = 1;
  while (i < end) {
    const raw = lines[i];
    const match = KEY_LINE.exec(raw);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    const rest = match[2].trim();

    if (BLOCK_SCALAR.test(rest)) {
      const { value, next } = readBlockScalar(lines, i + 1, end);
      data[key] = value;
      i = next;
      continue;
    }

    if (rest === '') {
      const { items, next } = readList(lines, i + 1, end);
      if (items.length > 0) {
        data[key] = items;
        i = next;
        continue;
      }
      // A plain scalar wrapped onto indented lines (`description:` then prose below it)
      // is folded into one line, as YAML does. An indented `key: value` is a nested map,
      // which stays empty here.
      const folded = readBlockScalar(lines, i + 1, end);
      const firstLine = lines.slice(i + 1, folded.next).find((l) => l.trim() !== '');
      if (folded.value !== '' && firstLine !== undefined && !/^\s+[A-Za-z0-9_-]+:(\s|$)/.test(firstLine)) {
        data[key] = folded.value.replace(/\s*\n\s*/g, ' ');
        i = folded.next;
        continue;
      }
      data[key] = '';
      i++;
      continue;
    }

    data[key] = parseScalar(rest);
    i++;
  }

  return { data, body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''), hasFrontmatter: true };
}

/** Indented continuation lines, dedented by the smallest indent present. */
function readBlockScalar(lines: string[], start: number, end: number): { value: string; next: number } {
  const collected: string[] = [];
  let i = start;
  for (; i < end; i++) {
    const line = lines[i];
    if (line.trim() !== '' && !/^\s/.test(line)) {
      break; // back at column 0: a new key
    }
    collected.push(line);
  }
  while (collected.length > 0 && collected[collected.length - 1].trim() === '') {
    collected.pop();
  }
  const indents = collected.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length);
  const strip = indents.length > 0 ? Math.min(...indents) : 0;
  return { value: collected.map((l) => l.slice(strip)).join('\n').trim(), next: i };
}

function readList(lines: string[], start: number, end: number): { items: string[]; next: number } {
  const items: string[] = [];
  let i = start;
  for (; i < end; i++) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m) {
      break;
    }
    items.push(unquote(m[1].trim()));
  }
  return { items, next: i };
}

function parseScalar(rest: string): FrontmatterValue {
  if (rest.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(rest);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v));
      }
    } catch {
      // Not valid JSON -- fall through to the bracket-stripping path below, which
      // handles `[a, b]` written without quotes.
    }
    return rest
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter((s) => s !== '');
  }
  return unquote(rest);
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Normalise a `tools` / `allowed-tools` value, which appears in both syntaxes. */
export function toolList(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => v.trim()).filter((v) => v !== '');
  }
  return value
    .split(',')
    .map((v) => unquote(v.trim()))
    .filter((v) => v !== '');
}

/** Collapse a value to one display line. */
export function asText(value: FrontmatterValue | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const joined = Array.isArray(value) ? value.join(', ') : value;
  const flat = joined.replace(/\s+/g, ' ').trim();
  return flat === '' ? undefined : flat;
}

/** For files with no frontmatter: the first non-empty, non-heading line. */
export function firstMeaningfulLine(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('---')) {
      continue;
    }
    return trimmed;
  }
  return undefined;
}
