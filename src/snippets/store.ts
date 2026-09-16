/**
 * Prompt snippets: reusable instructions, commands and fragments to paste into Claude Code
 * or file into CLAUDE.md and rules. Plain data with no `vscode` import; the view persists it
 * in VS Code's global storage, never in a browsed folder.
 *
 * Loading tolerates a hand-edited or partly broken file: malformed entries are dropped,
 * never thrown on.
 */

export interface Snippet {
  id: string;
  title: string;
  text: string;
  tags: string[];
  created: number;
  updated: number;
}

export interface SnippetFile {
  version: 1;
  snippets: Snippet[];
}

export function parseSnippets(text: string | undefined): Snippet[] {
  if (!text) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { snippets?: unknown } | null)?.snippets;
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  const out: Snippet[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== 'string') {
      continue;
    }
    let id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : newId();
    while (seen.has(id)) {
      id = newId();
    }
    seen.add(id);
    const now = Date.now();
    out.push({
      id,
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 200) : titleFrom(r.text),
      text: r.text,
      tags: normalizeTags(Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : []),
      created: typeof r.created === 'number' ? r.created : now,
      updated: typeof r.updated === 'number' ? r.updated : now,
    });
  }
  return out;
}

export function serializeSnippets(snippets: readonly Snippet[]): string {
  const file: SnippetFile = { version: 1, snippets: [...snippets] };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Merge imported snippets, skipping ones whose title and text already exist. */
export function mergeSnippets(current: readonly Snippet[], incoming: readonly Snippet[]): { snippets: Snippet[]; added: number } {
  const key = (s: Snippet): string => JSON.stringify([s.title, s.text]);
  const have = new Set(current.map(key));
  const ids = new Set(current.map((s) => s.id));
  const added: Snippet[] = [];
  for (const s of incoming) {
    if (have.has(key(s))) {
      continue;
    }
    have.add(key(s));
    added.push(ids.has(s.id) ? { ...s, id: newId() } : s);
  }
  return { snippets: [...current, ...added], added: added.length };
}

export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter((t) => t !== '' && t.length <= 40))].sort();
}

export function parseTagInput(input: string): string[] {
  return normalizeTags(input.split(/[,\s]+/));
}

export function titleFrom(text: string): string {
  const line = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l !== '') ?? 'Untitled snippet';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Text to append to a markdown file: separated from what is there by one blank line. */
export function appendBlock(existing: string, block: string): string {
  const body = block.replace(/\s+$/, '');
  if (existing.trim() === '') {
    return `${body}\n`;
  }
  return `${existing.replace(/\s+$/, '')}\n\n${body}\n`;
}
