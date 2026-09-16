import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';

/**
 * Text-level JSON edits with no `vscode` import, so they run in plain Node. Everything
 * here goes through `jsonc-parser`, which rewrites only the touched key and keeps the
 * rest of the file byte for byte.
 */

/** Strict JSON object or a thrown error: Claude Code rejects anything looser. */
export function parseStrict(text: string, file: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parse(text.replace(/^﻿/, ''), errors, { allowTrailingComma: false }) as unknown;
  if (errors.length > 0 || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not valid JSON, so it was left untouched. Fix it first.`);
  }
  return parsed as Record<string, unknown>;
}

/** Set one value, creating the objects on the way. */
export function setValue(text: string, jsonPath: (string | number)[], value: unknown): string {
  return applyEdits(text, modify(text, jsonPath, value, formatting(text)));
}

/** Append to a list, creating the list and its parents when missing. */
export function appendToList(text: string, jsonPath: string[], item: unknown): string {
  return applyEdits(text, modify(text, [...jsonPath, -1], item, { ...formatting(text), isArrayInsertion: true }));
}

function formatting(text: string): { formattingOptions: { insertSpaces: boolean; tabSize: number } } {
  return { formattingOptions: { insertSpaces: !/\n\t/.test(text), tabSize: indentOf(text) } };
}

/** Keep the file's own indent width; Claude Code writes 2 spaces. */
function indentOf(text: string): number {
  const match = /\n( +)"/.exec(text);
  return match ? match[1].length : 2;
}
