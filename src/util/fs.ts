import * as fs from 'fs';
import * as path from 'path';

/**
 * Filesystem helpers that never throw. A missing directory is the normal case here --
 * `~/.claude/agents/` does not exist on this machine, and most projects have only a
 * subset of the possible asset folders. Discovery must treat absence as "nothing to
 * show", never as an error.
 */

export function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** Last-modified time in epoch ms, or undefined if the path has gone. */
export function mtime(target: string): number | undefined {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return undefined;
  }
}

export function readText(target: string): string | undefined {
  try {
    return fs.readFileSync(target, 'utf8');
  } catch {
    return undefined;
  }
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
