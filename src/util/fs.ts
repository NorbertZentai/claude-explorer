import * as fs from 'fs';
import * as path from 'path';

/**
 * Filesystem helpers that never throw. A missing directory is the normal case here --
 * `~/.claude/agents/` does not exist on this machine, and most projects have only a
 * subset of the possible asset folders. Discovery must treat absence as "nothing to
 * show", never as an error.
 */

/**
 * One scan's reads, memoised.
 *
 * A scan asks about the same path several times -- a settings file is stat-ed to see whether
 * it exists, read for its settings, read again for its hooks, and stat-ed once more for the
 * mtime pass -- and measuring showed 42% of the stat calls and 22% of the reads were repeats
 * of a path already visited in the same pass. A scan is a snapshot of the disk at one moment,
 * so answering twice from one read is not only cheaper, it is more consistent.
 *
 * Undefined outside a scan, so every other caller goes straight to the filesystem.
 */
let scan: { stats: Map<string, fs.Stats | null>; texts: Map<string, string | undefined> } | undefined;

/** Start memoising. Discovery calls this; it must be paired with `endScan` in a finally. */
export function beginScan(): void {
  scan = { stats: new Map(), texts: new Map() };
}

/** Stop memoising and release the snapshot, so the next scan sees the disk as it is now. */
export function endScan(): void {
  scan = undefined;
}

function statOf(target: string): fs.Stats | null {
  const cached = scan?.stats.get(target);
  if (cached !== undefined) {
    return cached;
  }
  let result: fs.Stats | null;
  try {
    result = fs.statSync(target);
  } catch {
    result = null;
  }
  scan?.stats.set(target, result);
  return result;
}

export function isDir(target: string): boolean {
  return statOf(target)?.isDirectory() ?? false;
}

export function isFile(target: string): boolean {
  return statOf(target)?.isFile() ?? false;
}

/** Last-modified time in epoch ms, or undefined if the path has gone. */
export function mtime(target: string): number | undefined {
  return statOf(target)?.mtimeMs;
}

/**
 * File contents kept between scans, revalidated against the file's own timestamp and size.
 *
 * Opening a file costs about thirteen times what stat-ing it does (measured on Windows, where
 * every open is scanned), and a rescan re-reads every file even when one unrelated file
 * changed. So the read is replaced by a stat whenever the file is demonstrably the same one.
 */
interface CachedFile {
  mtimeMs: number;
  size: number;
  text: string | undefined;
}
const contents = new Map<string, CachedFile>();
let cachedChars = 0;

/** Total characters held. Configuration is small; this only guards against a pathological file. */
const CACHE_BUDGET_CHARS = 4_000_000;
const MAX_CACHED_CHARS = 256_000;
/**
 * A file written moments ago may be written again before its timestamp can distinguish the
 * two, so a just-modified file is always re-read. In practice this only affects the file
 * someone is editing right now, which is the one worth re-reading anyway.
 */
const SETTLED_MS = 1_000;

/** Forget every cached file. For tests, and for anything that invalidates the whole picture. */
export function clearFileCache(): void {
  contents.clear();
  cachedChars = 0;
}

export function readText(target: string): string | undefined {
  const withinScan = scan?.texts;
  if (withinScan) {
    const cached = withinScan.get(target);
    if (cached !== undefined || withinScan.has(target)) {
      return cached;
    }
  }
  const text = readValidated(target);
  withinScan?.set(target, text);
  return text;
}

function readValidated(target: string): string | undefined {
  const stats = statOf(target);
  if (!stats?.isFile()) {
    // Gone, or never was a file. Both mean the same to every caller here.
    contents.delete(target);
    return undefined;
  }
  const entry = contents.get(target);
  const settled = Date.now() - stats.mtimeMs > SETTLED_MS;
  if (entry && settled && entry.mtimeMs === stats.mtimeMs && entry.size === stats.size) {
    return entry.text;
  }
  let text: string | undefined;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch {
    text = undefined;
  }
  remember(target, stats, text);
  return text;
}

function remember(target: string, stats: fs.Stats, text: string | undefined): void {
  const previous = contents.get(target);
  if (previous) {
    cachedChars -= previous.text?.length ?? 0;
    contents.delete(target);
  }
  const chars = text?.length ?? 0;
  if (chars > MAX_CACHED_CHARS) {
    return;
  }
  if (cachedChars + chars > CACHE_BUDGET_CHARS) {
    clearFileCache();
  }
  contents.set(target, { mtimeMs: stats.mtimeMs, size: stats.size, text });
  cachedChars += chars;
}

/**
 * A leading BOM is normal on Windows -- PowerShell redirection and Notepad both write one
 * -- and Claude Code tolerates it. `JSON.parse` does not. Failing to strip it made the
 * extension accuse valid settings of being malformed, silently empty the plugin list, and
 * report "not signed in" while signed in.
 */
export function readJson<T>(target: string): T | undefined {
  const text = readText(target);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(stripJsonComments(text.replace(/^﻿/, ''))) as T;
  } catch {
    return undefined;
  }
}

/** Did the file exist but fail to parse? Distinguishes "absent" from "broken". */
export function isUnparsableJson(target: string): boolean {
  return isFile(target) && readJson(target) === undefined;
}

/** Claude's settings files are plain JSON, but hand-edited files pick up // comments. */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Immediate subdirectory names, excluding VCS and bookkeeping dirs. */
export function subdirs(target: string): string[] {
  try {
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !isNoise(name))
      .sort();
  } catch {
    return [];
  }
}

export function filesWithExtension(target: string, ext: string): string[] {
  try {
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
      .map((e) => path.join(target, e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * `.git` appears inside a skill directory here (translation-quality is a cloned repo),
 * and `.in_use/<pid>` marker dirs appear inside plugin caches as GC bookkeeping.
 * Neither is content.
 */
function isNoise(name: string): boolean {
  return name === '.git' || name === '.in_use' || name === 'node_modules' || name === '__pycache__';
}

/** 0-based line index of the first line matching `needle`, for opening a file in place. */
export function findLine(text: string | undefined, needle: string): number | undefined {
  if (!text) {
    return undefined;
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      return i;
    }
  }
  return undefined;
}
