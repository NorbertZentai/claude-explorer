import * as os from 'os';
import * as path from 'path';
import { isFile, readText } from '../util/fs';

/**
 * `@path` imports in memory files, per code.claude.com/docs/en/memory:
 *
 *   - relative paths resolve against the file that contains the import, `~/` against home
 *   - imported files can import again, at most four hops deep
 *   - imports inside code spans and fenced code blocks are literal text, not imports
 *   - imported files load at launch, so they cost context like the file that names them
 *
 * Block-level HTML comments are stripped before a memory file reaches the context, so
 * they are removed here too, and an `@path` inside one is not an import.
 */

export const MAX_IMPORT_DEPTH = 4;

export interface ImportRef {
  /** As written after the `@`. */
  raw: string;
  /** Absolute path it resolves to. */
  resolved: string;
  /** 0-based line of the reference in the importing file. */
  line: number;
}

export interface ImportedFile {
  file: string;
  importedBy: string;
  /** 1 for a direct import. */
  depth: number;
}

/** The text Claude Code actually injects: block-level `<!-- -->` comments removed. */
export function stripBlockComments(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inComment) {
      const marker = /^(```+|~~~+)/.exec(trimmed)?.[1];
      if (fence) {
        out.push(line);
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
          fence = undefined;
        }
        continue;
      }
      if (marker) {
        fence = marker;
        out.push(line);
        continue;
      }
      if (!trimmed.startsWith('<!--')) {
        out.push(line);
        continue;
      }
      inComment = true;
    }
    const end = line.indexOf('-->');
    if (end !== -1) {
      inComment = false;
      const rest = line.slice(end + 3);
      if (rest.trim() !== '') {
        out.push(rest);
      }
    }
  }
  return out.join('\n');
}

/** Every `@path` reference outside code, resolved against `file`'s directory. */
export function findImports(text: string, file: string): ImportRef[] {
  const lines = stripBlockComments(text).split('\n');
  const refs: ImportRef[] = [];
  let fence: string | undefined;
  lines.forEach((line, index) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    // Inline code spans are literal; blank them out but keep the column positions.
    const visible = line.replace(/(`+)[\s\S]*?\1/g, (span) => ' '.repeat(span.length));
    for (const match of visible.matchAll(/(^|[\s(])@((?:~\/|\.{1,2}\/|\/)?[A-Za-z0-9_.\-/~]+)/g)) {
      const raw = match[2].replace(/[.,;:)]+$/, '');
      if (!looksLikePath(raw)) {
        continue;
      }
      refs.push({ raw, resolved: resolvePath(raw, file), line: index });
    }
  });
  return refs;
}

/**
 * `@alice` in prose is a mention, not an import. Treat a reference as a path when it has a
 * directory part or a file extension, or names an existing file (the docs' `@README`).
 */
function looksLikePath(raw: string): boolean {
  return raw.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(raw);
}

function resolvePath(raw: string, file: string): string {
  if (raw.startsWith('~/')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(path.dirname(file), raw);
}

/** Files that load because `file` imports them, directly or transitively, existing only. */
export function expandImports(file: string): ImportedFile[] {
  const out: ImportedFile[] = [];
  const seen = new Set<string>([path.resolve(file)]);
  const visit = (current: string, depth: number): void => {
    if (depth > MAX_IMPORT_DEPTH) {
      return;
    }
    for (const ref of findImports(readText(current) ?? '', current)) {
      if (seen.has(ref.resolved) || !isFile(ref.resolved)) {
        continue;
      }
      seen.add(ref.resolved);
      out.push({ file: ref.resolved, importedBy: current, depth });
      visit(ref.resolved, depth + 1);
    }
  };
  visit(file, 1);
  return out;
}

/** A readable problem for imports that point nowhere or nest too deeply, if any. */
export function importProblem(file: string): string | undefined {
  const missing = findImports(readText(file) ?? '', file).filter((r) => !isFile(r.resolved));
  if (missing.length > 0) {
    const names = missing.slice(0, 3).map((r) => `@${r.raw}`).join(', ');
    return `Imports a file that does not exist: ${names}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`;
  }
  const expanded = expandImports(file);
  const loaded = new Set([path.resolve(file), ...expanded.map((f) => f.file)]);
  const tooDeep = expanded.some(
    (f) =>
      f.depth === MAX_IMPORT_DEPTH &&
      findImports(readText(f.file) ?? '', f.file).some((r) => isFile(r.resolved) && !loaded.has(r.resolved)),
  );
  return tooDeep ? `Imports nest deeper than ${MAX_IMPORT_DEPTH} hops; Claude Code stops following them there.` : undefined;
}
