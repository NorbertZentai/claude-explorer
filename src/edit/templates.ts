import { AssetKind } from '../discovery/types';

/**
 * Starting points for new configuration, written against the field references at
 * code.claude.com/docs. Every template is valid as it stands and leaves exactly one
 * obvious placeholder to fill in, which the editor selects on open.
 */

export type CreatableFileKind = 'skill' | 'command' | 'agent' | 'rule' | 'outputStyle';

export interface Template {
  /** Relative to the surface directory: `<name>/SKILL.md` for a skill, `<name>.md` otherwise. */
  relPath: string;
  content: string;
  /** Text to select once the file opens, so typing replaces the placeholder. */
  select: string;
}

export const CREATABLE_KINDS = new Set<AssetKind>(['skill', 'command', 'agent', 'rule', 'outputStyle', 'hook']);

export function templateFor(kind: CreatableFileKind, name: string): Template {
  switch (kind) {
    case 'skill': {
      const select = '<What it does>. Use when <situation>.';
      return {
        relPath: `${name}/SKILL.md`,
        select,
        content: `---
name: ${name}
description: ${select}
# when_to_use: trigger phrases or example requests. Counts toward the 1,536-character listing.
---

# ${title(name)}

1. <First step>
2. <Second step>

## Additional resources

<!-- Keep this file short. Move long reference material into files next to it, such as
     reference.md, and link them from here; they load only when Claude opens them. -->
`,
      };
    }
    case 'command': {
      const select = '<What it does>';
      return {
        relPath: `${name}.md`,
        select,
        content: `---
description: ${select}
argument-hint: [<arguments>]
---

<Instructions for Claude.> Use $ARGUMENTS for whatever is typed after /${name}.
`,
      };
    }
    case 'agent': {
      const select = 'Use this agent when <situation>.';
      return {
        relPath: `${name}.md`,
        select,
        content: `---
name: ${name}
description: ${select}
# Give it only the tools it needs; omit the line to inherit every tool.
tools: Read, Grep, Glob
model: inherit
---

You are <role>. When invoked:

1. <First step>
2. <Second step>

Report back with <what the caller needs>.
`,
      };
    }
    case 'rule': {
      const select = '<The rule, stated as an instruction.>';
      return {
        relPath: `${name}.md`,
        select,
        content: `---
# Without paths this rule loads into every session. With it, only when Claude reads matching files.
# paths: src/**/*.ts
---

${select}
`,
      };
    }
    case 'outputStyle': {
      const select = '<How responses should read>';
      return {
        relPath: `${name}.md`,
        select,
        content: `---
name: ${title(name)}
description: ${select}
---

<Instructions for tone, format and structure of every response.>
`,
      };
    }
  }
}

/** A hook script that reads the event JSON and lets the action through. */
export function hookScriptTemplate(event: string): string {
  return `#!/usr/bin/env bash
# ${event} hook. Claude Code sends the event as JSON on stdin.
# Exit 0 to continue. Exit 2 to block the action; whatever you print to stderr is shown to Claude.
set -euo pipefail

input="$(cat)"
# Example: tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

exit 0
`;
}

export function settingsSkeleton(): string {
  return `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json"
}
`;
}

export function claudeMdSkeleton(projectName: string): string {
  return `# ${projectName}

<!-- Everything in this file loads into every Claude Code session in this project.
     Keep it short: facts Claude cannot find by reading the code. -->

## Commands

<!-- How to build, test and run a single test. -->

## Architecture

<!-- The big picture that takes several files to understand. -->

## Conventions

<!-- Rules the code follows that are not obvious from reading it. -->
`;
}

const IGNORED = ['.claude/settings.local.json', 'CLAUDE.local.md'];

/** Lines to append to a .gitignore so private Claude files stay out of git; empty if present. */
export function gitignoreAdditions(existing: string): string {
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim().replace(/^\//, '')));
  const missing = IGNORED.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return '';
  }
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return `${lead}${existing === '' ? '' : '\n'}# Claude Code: private files\n${missing.join('\n')}\n`;
}

function title(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
