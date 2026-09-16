import { parseStrict, setValue } from './jsonText';

/**
 * Text-level edits to a settings file's `hooks` block, located by what a hook is (event,
 * matcher, command) rather than by array index, so several edits to one file in a row
 * cannot hit the wrong entry after an earlier one shifted the indices.
 *
 *   "hooks": { "<Event>": [ { "matcher": "…", "hooks": [ { "type": "command", "command": "…" } ] } ] }
 *
 * Emptied groups and events are removed rather than left as `[]` noise.
 */

export interface HookIdentity {
  event: string;
  /** Undefined or '' for a group without a matcher. */
  matcher?: string;
  command: string;
}

export interface HookHandler {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface Group {
  matcher?: unknown;
  hooks?: unknown;
}

function sameMatcher(a: unknown, b: string | undefined): boolean {
  const norm = (m: unknown): string => (typeof m === 'string' && m !== '*' ? m : '');
  return norm(a) === norm(b);
}

function hooksOf(text: string, file: string): Record<string, unknown> {
  const settings = parseStrict(text, file);
  const hooks = settings.hooks;
  if (hooks === undefined) {
    return {};
  }
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error(`"hooks" in ${file} is not an object, so it was left untouched.`);
  }
  return hooks as Record<string, unknown>;
}

/** The handler object as written, for moving it elsewhere with its timeout and options. */
export function findHook(text: string, file: string, id: HookIdentity): HookHandler | undefined {
  const groups = hooksOf(text, file)[id.event];
  if (!Array.isArray(groups)) {
    return undefined;
  }
  for (const group of groups as Group[]) {
    if (!sameMatcher(group?.matcher, id.matcher) || !Array.isArray(group.hooks)) {
      continue;
    }
    const handler = (group.hooks as HookHandler[]).find((h) => h?.command === id.command);
    if (handler) {
      return handler;
    }
  }
  return undefined;
}

export function removeHookText(text: string, file: string, id: HookIdentity): string {
  const hooks = hooksOf(text, file);
  const groups = hooks[id.event];
  if (!Array.isArray(groups)) {
    throw new Error(`No ${id.event} hooks in ${file}.`);
  }
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g] as Group;
    if (!sameMatcher(group?.matcher, id.matcher) || !Array.isArray(group.hooks)) {
      continue;
    }
    const h = (group.hooks as HookHandler[]).findIndex((x) => x?.command === id.command);
    if (h === -1) {
      continue;
    }
    if (group.hooks.length > 1) {
      return setValue(text, ['hooks', id.event, g, 'hooks', h], undefined);
    }
    if (groups.length > 1) {
      return setValue(text, ['hooks', id.event, g], undefined);
    }
    if (Object.keys(hooks).length > 1) {
      return setValue(text, ['hooks', id.event], undefined);
    }
    return setValue(text, ['hooks'], undefined);
  }
  throw new Error(`That ${id.event} hook is no longer in ${file}. Refresh and try again.`);
}

/** Add a handler under an event, joining an existing group with the same matcher. */
export function insertHookText(text: string, file: string, event: string, matcher: string | undefined, handler: HookHandler): string {
  const hooks = hooksOf(text, file);
  const groups = hooks[event];
  if (groups !== undefined && !Array.isArray(groups)) {
    throw new Error(`hooks.${event} in ${file} is not a list, so it was left untouched.`);
  }
  const list = (groups ?? []) as Group[];
  const g = list.findIndex((group) => sameMatcher(group?.matcher, matcher) && Array.isArray(group.hooks));
  if (g !== -1) {
    const existing = list[g].hooks as HookHandler[];
    if (existing.some((h) => h?.command === handler.command)) {
      return text;
    }
    return setValue(text, ['hooks', event, g, 'hooks', existing.length], handler);
  }
  const group: Record<string, unknown> = matcher ? { matcher, hooks: [handler] } : { hooks: [handler] };
  return setValue(text, ['hooks', event, list.length], group);
}

/** Change a hook's event, matcher or command in place (same file). */
export function updateHookText(text: string, file: string, id: HookIdentity, next: HookIdentity): string {
  const handler = findHook(text, file, id);
  if (!handler) {
    throw new Error(`That ${id.event} hook is no longer in ${file}. Refresh and try again.`);
  }
  const removed = removeHookText(text, file, id);
  return insertHookText(removed, file, next.event, next.matcher, { ...handler, command: next.command });
}

/** Remove one string from a top-level list such as enabledMcpjsonServers. */
export function removeListItemText(text: string, file: string, key: string, value: string): string {
  const settings = parseStrict(text, file);
  const list = settings[key];
  if (!Array.isArray(list)) {
    return text;
  }
  const index = list.indexOf(value);
  return index === -1 ? text : setValue(text, [key, index], undefined);
}
