import * as fs from 'fs';
import * as path from 'path';

/**
 * How often skills, slash commands and subagents were actually used, counted from Claude
 * Code's local transcripts (`<config dir>/projects/<slug>/*.jsonl`). Opt-in only
 * (`claudeExplorer.readTranscriptsForUsage`): transcripts hold whole conversations.
 *
 * Only three signals are read, and only their names and timestamps are kept:
 *   - an assistant `tool_use` block named `Skill`, whose input names the skill
 *   - an `Agent` (or older `Task`) `tool_use` block, whose input names the subagent type
 *   - `<command-name>/x</command-name>` in a user message, when you typed a slash command
 * Lines that do not contain one of the markers are never parsed. Nothing is written.
 */

export interface UsageEntry {
  count: number;
  lastUsed: number;
}

export interface UsageReport {
  /** Keyed `skill:<name>` (skills and slash commands share names) or `agent:<type>`. */
  entries: Map<string, UsageEntry>;
  filesRead: number;
  since: number;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const cache = new Map<string, { mtime: number; hits: Array<[string, number]> }>();

export function readUsage(claudeDir: string, now: number, days = 90): UsageReport {
  const since = now - days * 86_400_000;
  const entries = new Map<string, UsageEntry>();
  let filesRead = 0;
  const projects = path.join(claudeDir, 'projects');
  for (const project of safeReaddir(projects)) {
    const dir = path.join(projects, project);
    for (const name of safeReaddir(dir)) {
      if (!name.endsWith('.jsonl')) {
        continue;
      }
      const file = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.mtimeMs < since || stat.size > MAX_FILE_BYTES) {
        continue;
      }
      let cached = cache.get(file);
      if (!cached || cached.mtime !== stat.mtimeMs) {
        let text = '';
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        cached = { mtime: stat.mtimeMs, hits: usageHits(text, stat.mtimeMs) };
        cache.set(file, cached);
      }
      filesRead++;
      for (const [key, at] of cached.hits) {
        if (at < since) {
          continue;
        }
        const entry = entries.get(key) ?? { count: 0, lastUsed: 0 };
        entry.count++;
        entry.lastUsed = Math.max(entry.lastUsed, at);
        entries.set(key, entry);
      }
    }
  }
  return { entries, filesRead, since };
}

/** The usage signals in one transcript, as [key, epoch ms]. Exported for tests. */
export function usageHits(text: string, fallbackTime: number): Array<[string, number]> {
  const hits: Array<[string, number]> = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"Skill"') && !line.includes('command-name') && !line.includes('"Agent"') && !line.includes('"Task"')) {
      continue;
    }
    let record: { timestamp?: unknown; message?: { role?: unknown; content?: unknown } };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const at = typeof record.timestamp === 'string' && !Number.isNaN(Date.parse(record.timestamp)) ? Date.parse(record.timestamp) : fallbackTime;
    const content = record.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const b = block as { type?: unknown; name?: unknown; input?: Record<string, unknown>; text?: unknown };
      if (b.type === 'tool_use' && b.name === 'Skill' && typeof b.input?.skill === 'string') {
        hits.push([`skill:${b.input.skill.replace(/^\//, '')}`, at]);
      } else if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && typeof b.input?.subagent_type === 'string') {
        hits.push([`agent:${b.input.subagent_type}`, at]);
      } else if (b.type === 'text' && typeof b.text === 'string' && record.message?.role === 'user') {
        hits.push(...commandHits(b.text, at));
      }
    }
    if (typeof content === 'string' && record.message?.role === 'user') {
      hits.push(...commandHits(content, at));
    }
  }
  return hits;
}

function commandHits(text: string, at: number): Array<[string, number]> {
  return [...text.matchAll(/<command-name>\/?([A-Za-z0-9_.:-]+)<\/command-name>/g)].map((m): [string, number] => [`skill:${m[1]}`, at]);
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
