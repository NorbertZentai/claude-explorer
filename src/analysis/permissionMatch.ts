import * as os from 'os';
import * as path from 'path';
import { escapeRegExp, globToRegExp } from '../util/glob';

/**
 * Which permission rule decides a given tool call, following code.claude.com/docs/en/permissions.
 * An approximation of Claude Code's matcher, good enough to answer "why was this
 * allowed?" and always presented as such:
 *
 *   - deny rules are checked first, then ask, then allow; the first match decides
 *   - Bash: compound commands split on && || ; | |& & and newlines; deny and ask apply when
 *     any part matches, allow only when every part matches; a small set of wrappers
 *     (timeout, nice, nohup, …) and leading VAR=value assignments are stripped first;
 *     `*` matches any text, a trailing ` *` also matches the bare command, `:*` = ` *`
 *   - Read/Edit: gitignore-style paths anchored by `//` (root), `~/` (home), `/` (the
 *     settings source) or nothing (the working directory); a bare name matches at any depth
 *   - WebFetch(domain:…): `*.x.com` is any subdomain, a bare `*` is everything, any other
 *     `*` stays within one label
 *   - mcp__server matches every tool of that server; deny and ask accept tool-name globs
 */

export type RuleList = 'deny' | 'ask' | 'allow';

export interface RuleInput {
  list: RuleList;
  rule: string;
  /** e.g. "project local"; decides what a leading `/` anchors to. */
  sourceLabel: string;
  sourcePath: string;
  line?: number;
}

export interface ToolCall {
  tool: string;
  /** The command, path, URL or name inside the parentheses. */
  arg?: string;
}

export interface MatchResult {
  decision: RuleList | 'none';
  /** The rules that decided it: one for deny/ask, one per subcommand for allow. */
  rules: RuleInput[];
  explanation: string;
}

export interface MatchContext {
  /** The session's working directory: the project root. */
  cwd: string;
  /** Where `/path` in user settings anchors: `~/.claude`. */
  userClaudeDir: string;
  home?: string;
}

const WRAPPERS = /^(?:(?:timeout|gtimeout)\s+(?:-\S+\s+)*\S+|time|nice(?:\s+-n\s*-?\d+)?|nohup|stdbuf(?:\s+-\S+)*|command|builtin|noglob|xargs)\s+/;
const FILE_READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** `Bash(npm test)` → { tool: 'Bash', arg: 'npm test' }; a bare name has no arg. */
export function parseToolCall(text: string): ToolCall | undefined {
  const m = /^\s*([A-Za-z0-9_*-]+)\s*(?:\(([\s\S]*)\))?\s*$/.exec(text);
  return m ? { tool: m[1], arg: m[2] } : undefined;
}

export function evaluate(callText: string, rules: readonly RuleInput[], ctx: MatchContext): MatchResult {
  const call = parseToolCall(callText);
  if (!call) {
    return { decision: 'none', rules: [], explanation: 'Write the call as Tool or Tool(argument), for example Bash(npm test) or Read(src/index.ts).' };
  }
  const parts = call.tool === 'Bash' || call.tool === 'PowerShell' ? splitCompound(call.arg ?? '') : [call.arg];

  for (const list of ['deny', 'ask'] as const) {
    for (const part of parts) {
      const hit = rules.find((r) => r.list === list && ruleMatches(r, { tool: call.tool, arg: part }, ctx));
      // A Read deny also stops edits to the same path.
      const readDeny =
        !hit && list === 'deny' && FILE_EDIT_TOOLS.has(call.tool)
          ? rules.find((r) => r.list === 'deny' && ruleMatches(r, { tool: 'Read', arg: part }, ctx))
          : undefined;
      const decided = hit ?? readDeny;
      if (decided) {
        const which = parts.length > 1 ? ` for the part "${part}"` : '';
        return {
          decision: list,
          rules: [decided],
          explanation: `${list === 'deny' ? 'Denied' : 'Asks first'}: ${decided.rule} in ${decided.sourceLabel} matches${which}. Deny is checked before ask, and ask before allow.`,
        };
      }
    }
  }

  const allowing: RuleInput[] = [];
  for (const part of parts) {
    const hit = rules.find((r) => r.list === 'allow' && ruleMatches(r, { tool: call.tool, arg: part }, ctx));
    if (!hit) {
      const unmatched = parts.length > 1 ? `"${part}" is not covered by any allow rule, so the whole command is not auto-approved. ` : 'No rule matches. ';
      return { decision: 'none', rules: allowing, explanation: `${unmatched}The permission mode decides: in the default mode Claude Code asks, except for read-only tools and commands.` };
    }
    allowing.push(hit);
  }
  return {
    decision: 'allow',
    rules: [...new Set(allowing)],
    explanation: `Allowed without asking by ${[...new Set(allowing.map((r) => `${r.rule} (${r.sourceLabel})`))].join(', ')}.`,
  };
}

export function ruleMatches(rule: RuleInput, call: ToolCall, ctx: MatchContext): boolean {
  const parsed = parseToolCall(rule.rule);
  if (!parsed) {
    return false;
  }
  const { tool, arg: spec } = parsed;

  if (!toolNameMatches(tool, call.tool, rule.list)) {
    // Read and Edit rules also govern the tools that read or edit files.
    const readFamily = tool === 'Read' && FILE_READ_TOOLS.has(call.tool);
    const editFamily = tool === 'Edit' && FILE_EDIT_TOOLS.has(call.tool);
    if (!readFamily && !editFamily) {
      return false;
    }
  }
  if (spec === undefined || spec.trim() === '*' && (tool === 'Bash' || tool === 'PowerShell')) {
    return true;
  }
  if (call.arg === undefined) {
    return false;
  }
  if (tool.startsWith('mcp__')) {
    return false; // skipped by Claude Code when written in a settings file
  }
  // Tool(param:value) needs the call's full input, which a typed test does not have.
  if (/^[a-z_]+\s*:/.test(spec) && !spec.startsWith('domain:')) {
    return false;
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    return commandMatches(spec, stripWrappers(call.arg), tool === 'PowerShell');
  }
  if (tool === 'WebFetch') {
    return domainMatches(spec, call.arg);
  }
  if (tool === 'Read' || tool === 'Edit') {
    return pathMatches(spec, call.arg, rule, ctx);
  }
  return commandMatches(spec, call.arg.trim(), false);
}

function toolNameMatches(ruleTool: string, callTool: string, list: RuleList): boolean {
  if (ruleTool === callTool) {
    return true;
  }
  if (/^mcp__[^_]/.test(ruleTool) && !ruleTool.includes('*') && callTool.startsWith(`${ruleTool}__`)) {
    return true;
  }
  if (!ruleTool.includes('*')) {
    return false;
  }
  // Allow globs only count after a literal mcp__<server>__ prefix.
  if (list === 'allow' && !/^mcp__[^*]+__/.test(ruleTool)) {
    return false;
  }
  return globToRegExp(ruleTool, false).test(callTool);
}

/** Split a shell command on its separators, ignoring those inside quotes. */
export function splitCompound(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '|&') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

function stripWrappers(command: string): string {
  let text = command.trim();
  for (;;) {
    const next = text.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, '').replace(WRAPPERS, '');
    if (next === text) {
      return text;
    }
    text = next;
  }
}

function commandMatches(spec: string, command: string, caseInsensitive: boolean): boolean {
  let pattern = spec.trim() === '' ? spec : spec.replace(/:\*$/, ' *');
  const wildcards = (pattern.match(/\*/g) ?? []).length;
  // A trailing " *" that is the only wildcard also matches the bare command.
  if (wildcards === 1 && pattern.endsWith(' *')) {
    const bare = pattern.slice(0, -2);
    if (normalize(command, caseInsensitive) === normalize(bare, caseInsensitive)) {
      return true;
    }
  }
  pattern = pattern.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${pattern}$`, caseInsensitive ? 'is' : 's').test(command);
}

function normalize(text: string, lower: boolean): string {
  return lower ? text.toLowerCase() : text;
}

function domainMatches(spec: string, arg: string): boolean {
  if (!spec.startsWith('domain:')) {
    return false;
  }
  const pattern = spec.slice('domain:'.length).trim().toLowerCase().replace(/\.$/, '');
  let host = arg.trim().toLowerCase();
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/.exec(host);
  host = (m ? m[1] : host.replace(/^domain:/, '').split(/[/:?#]/)[0]).replace(/\.$/, '');
  if (pattern === '*') {
    return true;
  }
  if (pattern.startsWith('*.')) {
    return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  }
  const regex = pattern.split('*').map(escapeRegExp).join('[^.]*');
  return new RegExp(`^${regex}$`).test(host);
}

function pathMatches(spec: string, arg: string, rule: RuleInput, ctx: MatchContext): boolean {
  const home = ctx.home ?? os.homedir();
  const raw = spec.trim();
  if (raw.startsWith('!')) {
    return false; // carve-outs narrow other rules; they never match on their own
  }
  let anchor: string;
  let rest: string;
  if (raw.startsWith('//')) {
    anchor = '/';
    rest = raw.slice(2);
  } else if (raw.startsWith('~/')) {
    anchor = home;
    rest = raw.slice(2);
  } else if (raw.startsWith('/')) {
    anchor = rule.sourceLabel.startsWith('user') ? ctx.userClaudeDir : ctx.cwd;
    rest = raw.slice(1);
  } else {
    anchor = ctx.cwd;
    rest = raw.replace(/^\.\//, '');
  }

  const target = arg.trim().startsWith('~/')
    ? path.join(home, arg.trim().slice(2))
    : path.resolve(ctx.cwd, arg.trim());
  const relative = path.relative(anchor, target).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  const unanchored = !raw.startsWith('/') && !raw.startsWith('~/');
  const slashFree = !rest.replace(/\/\*\*$/, '').includes('/');
  // gitignore: a bare name matches at any depth; a single directory segment does too for
  // deny and ask rules (allow rules stay at the top level).
  const anyDepth = unanchored && slashFree && (!rest.endsWith('/**') || rule.list !== 'allow');
  const body = globToRegExp(rest, true).source.slice(1, -1);
  const regex = new RegExp(`^${anyDepth ? '(?:.*/)?' : ''}${body}${rest.endsWith('/**') ? '' : '(?:/.*)?'}$`);
  return regex.test(relative === '' ? '.' : relative);
}
