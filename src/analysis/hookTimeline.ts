import { Asset } from '../discovery/types';
import { redactCommandLine } from '../util/redact';

/**
 * Every hook a session in one project would run, grouped by event in lifecycle order.
 * Rules from code.claude.com/docs/en/hooks:
 *
 *   - hooks from every settings level and every enabled plugin are merged, never replaced
 *   - all hooks matching one event run in parallel
 *   - the same handler declared in more than one settings file runs once; a plugin's copy
 *     of the same handler stays separate
 *   - a matcher of `*`, `""` or none matches everything; one made only of letters, digits,
 *     `_`, `-`, spaces, `,` and `|` is an exact name or list; anything else is a regex
 */

export interface HookEventInfo {
  name: string;
  /** When it fires, in a few words. */
  when: string;
}

/** Documented lifecycle order. An event missing here is still shown, at the end. */
export const HOOK_EVENTS: HookEventInfo[] = [
  { name: 'Setup', when: 'before the session, optional initialisation' },
  { name: 'SessionStart', when: 'once per session' },
  { name: 'UserPromptSubmit', when: 'every prompt you send' },
  { name: 'UserPromptExpansion', when: 'when a slash command expands' },
  { name: 'PreToolUse', when: 'before each tool call' },
  { name: 'PermissionRequest', when: 'when a tool call needs permission' },
  { name: 'PermissionDenied', when: 'when auto mode denies a tool call' },
  { name: 'PostToolUse', when: 'after a tool call succeeds' },
  { name: 'PostToolUseFailure', when: 'after a tool call fails' },
  { name: 'PostToolBatch', when: 'after a batch of parallel tool calls' },
  { name: 'Elicitation', when: 'when an MCP tool asks for input' },
  { name: 'ElicitationResult', when: 'when that input is returned' },
  { name: 'SubagentStart', when: 'when a subagent is spawned' },
  { name: 'SubagentStop', when: 'when a subagent finishes' },
  { name: 'TaskCreated', when: 'when a task is created' },
  { name: 'TaskCompleted', when: 'when a task completes' },
  { name: 'TeammateIdle', when: 'when an agent-team teammate goes idle' },
  { name: 'Stop', when: 'when Claude finishes a turn' },
  { name: 'StopFailure', when: 'when a turn ends on an API error' },
  { name: 'PreCompact', when: 'before context compaction' },
  { name: 'PostCompact', when: 'after context compaction' },
  { name: 'Notification', when: 'when a notification is sent (async)' },
  { name: 'MessageDisplay', when: 'while a message streams (async)' },
  { name: 'InstructionsLoaded', when: 'when CLAUDE.md is loaded (async)' },
  { name: 'ConfigChange', when: 'when configuration changes (async)' },
  { name: 'CwdChanged', when: 'when the working directory changes (async)' },
  { name: 'FileChanged', when: 'when a watched file changes (async)' },
  { name: 'DirectoryAdded', when: 'when a directory is added mid-session (async)' },
  { name: 'WorktreeCreate', when: 'when a worktree is created (async)' },
  { name: 'WorktreeRemove', when: 'when a worktree is removed (async)' },
  { name: 'PreModelSwitch', when: 'before the model is switched' },
  { name: 'PostModelSwitch', when: 'after the model changes (async)' },
  { name: 'SessionEnd', when: 'once, when the session ends' },
];

export type MatcherKind = 'all' | 'exact' | 'regex';

export interface TimelineHook {
  matcher: string;
  matcherKind: MatcherKind;
  /** Redacted; safe to render. */
  command: string;
  scopeLabel: string;
  sourcePath: string;
  line?: number;
  problem?: string;
  /** Set when an identical handler in a higher settings file already runs. */
  duplicateOf?: string;
}

export interface TimelineEvent extends HookEventInfo {
  known: boolean;
  hooks: TimelineHook[];
}

export function hookTimeline(assets: readonly Asset[], workspaceRoot: string | undefined): TimelineEvent[] {
  const disabledPlugins = new Set(
    assets.filter((a) => a.kind === 'plugin' && a.enabled === false).map((a) => a.scope.root),
  );
  const hooks = assets.filter(
    (a) =>
      a.kind === 'hook' &&
      a.hook !== undefined &&
      !a.placeholder &&
      (a.scope.kind === 'workspace' ? a.scope.root === workspaceRoot : !disabledPlugins.has(a.scope.root)),
  );

  const byEvent = new Map<string, TimelineHook[]>();
  // Settings-file handlers are deduplicated across files; plugin copies are not.
  const seen = new Map<string, string>();
  for (const asset of hooks.slice().sort((a, b) => SCOPE_ORDER[a.scope.kind] - SCOPE_ORDER[b.scope.kind])) {
    const decl = asset.hook!;
    const matcher = decl.matcher ?? '';
    const id = `${decl.event}|${matcher}|${decl.command}`;
    let duplicateOf: string | undefined;
    if (asset.scope.kind !== 'plugin') {
      duplicateOf = seen.get(id);
      if (!duplicateOf) {
        seen.set(id, asset.scope.label);
      }
    }
    const list = byEvent.get(decl.event) ?? [];
    list.push({
      matcher: matcher === '' ? '*' : matcher,
      matcherKind: matcherKind(matcher),
      command: redactCommandLine(decl.command.split(/\s+/)),
      scopeLabel: asset.scope.label,
      sourcePath: asset.sourcePath,
      line: asset.line,
      problem: asset.problem,
      duplicateOf,
    });
    byEvent.set(decl.event, list);
  }

  const out: TimelineEvent[] = [];
  for (const info of HOOK_EVENTS) {
    const list = byEvent.get(info.name);
    if (list) {
      out.push({ ...info, known: true, hooks: list });
      byEvent.delete(info.name);
    }
  }
  // Newer Claude Code versions add events; show them rather than drop them.
  for (const [name, list] of byEvent) {
    out.push({ name, when: 'not in this extension’s event list', known: false, hooks: list });
  }
  return out;
}

const SCOPE_ORDER: Record<Asset['scope']['kind'], number> = { system: 0, workspace: 1, user: 2, plugin: 3 };

export function matcherKind(matcher: string): MatcherKind {
  if (matcher === '' || matcher === '*') {
    return 'all';
  }
  return /^[A-Za-z0-9_\- ,|]+$/.test(matcher) ? 'exact' : 'regex';
}
