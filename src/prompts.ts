import { Asset } from './discovery/types';

/**
 * Paste-ready prompts about one specific item, the per-row counterpart of the setup prompts
 * in guides.ts. Each starts with the item's @-reference so Claude reads the file first.
 *
 * Built only from display fields (name, description, problem, override, hook event and
 * matcher). Never from raw commands or env blocks, so nothing secret can end up on the
 * clipboard.
 */

/** Prompts offered by the Overview page, keyed by the id its buttons send. */
export const PAGE_PROMPTS = {
  securityHardening:
    'Review the permission rules in my Claude Code settings for this project (.claude/settings.json, .claude/settings.local.json and ~/.claude/settings.json). Rules are checked deny, then ask, then allow, and the first match wins. Propose a tighter set: reading files inside the project is fine, edits should need approval outside src/ and tests, secrets such as .env files and ~/.ssh must be denied, curl, wget and other network commands should be denied in Bash, and web access should go through WebFetch(domain:…) rules only. If sandboxing is available, enable it with sandbox.network.allowedDomains limited to localhost and the package registries this project uses. Never print secret values. Show the diff of each settings file and wait for my approval before writing.',
} as const;

/** Set up Claude Code for a project from what is in it. */
export function workspaceSetupPrompt(projectName: string): string {
  return `Set up Claude Code for the ${projectName} project. 1) Read the build and dependency files that exist (package.json, Makefile, pyproject.toml, Cargo.toml, go.mod, pom.xml, build.gradle…) and the directory layout. 2) Create or improve CLAUDE.md at the project root: build, test and lint commands, plus the architecture rules and conventions Claude cannot infer from the code. Keep it under 200 lines. 3) Create a project skill at .claude/skills/run-tests/SKILL.md that runs the test suite and summarises failures, with a description that starts with what it does and then "Use when …". 4) Propose a PostToolUse hook in .claude/settings.json that runs the formatter or linter after Edit|Write, if the project has one. 5) Propose permission rules: allow the safe commands you found (tests, lint, build), deny reading .env files. Show every file before writing it and wait for my approval.`;
}

/** A new skill drafted by Claude, written to an exact location. */
export function draftSkillPrompt(name: string, purpose: string, skillFile: string): string {
  return `Write a new Claude Code skill named ${name} at ${skillFile}. What it should do: ${purpose.trim()}. Frontmatter: name: ${name}, and a description that starts with what the skill does followed by "Use when …" with concrete trigger situations (description plus when_to_use must stay under 1,536 characters). Add allowed-tools only for the tools it really needs. Body: short numbered steps; if a step needs a script, put the script next to SKILL.md and call it from the step. Keep SKILL.md under 500 lines and leave out anything Claude already knows. Show me the files before saving.`;
}

export const PERSONAL_PREFERENCES = [
  'Keep answers short and to the point.',
  'Write code in TypeScript unless I ask for another language.',
  'Do not use Tailwind unless I ask for it.',
  'Explain the plan in a few bullet points before large changes.',
  'Run the relevant tests before saying something is done.',
  'Answer in Hungarian, but keep code, identifiers and commit messages in English.',
];

/** Merge personal preferences into the user-level CLAUDE.md. */
export function personalisePrompt(preferences: readonly string[]): string {
  const list = preferences.map((p, i) => `(${i + 1}) ${p.trim().replace(/\.?$/, '.')}`).join(' ');
  return `Update my user-level ~/.claude/CLAUDE.md (create it if it does not exist) with these personal preferences: ${list} Keep what is already there, merge duplicates, ask me which one wins where two contradict, phrase each as a short concrete instruction, and keep the file under 200 lines. Show the diff before saving.`;
}

export interface ItemPrompt {
  label: string;
  detail: string;
  text: string;
}

export interface PromptContext {
  /** `@path` of the item. */
  ref: string;
  /** `@path` of the item that overrides this one, when it is overridden. */
  winnerRef?: string;
  /** Estimated startup tokens, for memory and rules. */
  tokens?: number;
}

export function promptsFor(asset: Asset, ctx: PromptContext): ItemPrompt[] {
  const { ref } = ctx;
  const name = asset.invocation ?? asset.name;
  const out: ItemPrompt[] = [];

  // What is wrong right now comes first: it is the most likely reason for asking.
  if (asset.problem) {
    out.push({
      label: 'Fix this problem',
      detail: asset.problem,
      text: `${ref} Explorer for Claude Code reports a problem with ${name}: "${asset.problem}". Find the cause, explain it in one or two sentences, and fix it. Ask before changing anything outside this file.`,
    });
  }
  if (asset.overriddenBy) {
    const winner = ctx.winnerRef ?? asset.overriddenBy.name;
    out.push({
      label: 'Resolve the name conflict',
      detail: `Overridden by ${asset.overriddenBy.name} in ${asset.overriddenBy.scopeLabel}`,
      text: `${ref} ${winner} Both define ${name}, and the second one wins (${asset.overriddenBy.reason}). Compare them, tell me whether one is an outdated copy of the other, and suggest whether to delete, rename or merge. Do not change files until I choose.`,
    });
  }

  switch (asset.kind) {
    case 'skill':
      out.push(
        explain(ref, `what the ${name} skill does, when Claude would load it, and what it needs to run`),
        {
          label: 'Improve the description',
          detail: 'So Claude loads it at the right moments',
          text: `${ref} Rewrite the description of this skill so Claude loads it reliably: lead with what it does, then "Use when …" with concrete trigger situations. description plus when_to_use is cut at 1,536 characters in the listing, so put the key use case first. Show me the new frontmatter before saving.`,
        },
        {
          label: 'Tighten it',
          detail: 'Shorter SKILL.md, detail moved into linked files',
          text: `${ref} Make this skill easier to follow: keep SKILL.md under 500 lines, move long reference material into separate files next to it and link them, and remove anything Claude already knows. Propose the new structure first.`,
        },
        {
          label: 'Suggest trigger tests',
          detail: 'Prompts that should, and should not, load it',
          text: `${ref} Write 5 prompts that should make Claude load this skill and 5 similar ones that should not. For any case the current description would get wrong, say why.`,
        },
      );
      break;
    case 'command':
      out.push(
        explain(ref, `what /${asset.name} does and what arguments it expects`),
        {
          label: 'Convert into a skill',
          detail: 'Commands and skills share one system now',
          text: `${ref} Convert this slash command into a skill at the same level: a folder with SKILL.md, keeping /${asset.name} working, with a description that says when to use it. Keep $ARGUMENTS handling. Show me the result before deleting the command file.`,
        },
        improve(ref, 'this command'),
      );
      break;
    case 'agent':
      out.push(
        explain(ref, `when Claude delegates to the ${asset.name} subagent and what it returns`),
        {
          label: 'Review its tools',
          detail: 'Least privilege',
          text: `${ref} Review the tools this subagent has against what its instructions actually need. Suggest the smallest tool list that still works, and point out anything that could modify files or run commands without a reason.`,
        },
        {
          label: 'Improve its description',
          detail: 'So Claude delegates to it at the right time',
          text: `${ref} Rewrite this subagent's description so Claude delegates to it at the right moments and not otherwise. Start with "Use this agent when …" and include one or two short examples.`,
        },
      );
      break;
    case 'hook': {
      const when = asset.hook
        ? `on ${asset.hook.event}${asset.hook.matcher ? ` for tools matching ${asset.hook.matcher}` : ''}`
        : 'when it fires';
      out.push(
        explain(ref, `what the "${asset.name}" hook does ${when}, and what happens when it exits non-zero`),
        {
          label: 'Review for safety',
          detail: 'Injection, blocking, timeouts',
          text: `${ref} Review the "${asset.name}" hook, which runs ${when}. Check for shell injection from the event JSON on stdin, unquoted variables, commands that could hang without a timeout, and cases where it blocks something it should not. List issues by severity with a fix for each.`,
        },
        {
          label: 'Debug why it does not fire',
          detail: 'Matcher, event, path and permissions',
          text: `${ref} The "${asset.name}" hook should run ${when} but does not seem to. Check the event name, the matcher, the script path and its execute permission, and which settings file declares it. Tell me how to verify each step.`,
        },
      );
      break;
    }
    case 'mcp':
      out.push(
        explain(ref, `what the ${asset.name} MCP server gives Claude and when Claude should use it`),
        {
          label: 'Review the configuration',
          detail: 'Secrets and risky access',
          text: `${ref} Review how the ${asset.name} MCP server is configured. Point out credentials written in plain text that should come from environment variables, overly broad access, and whether it belongs in project or user scope. Do not print any secret values in your answer.`,
        },
      );
      break;
    case 'memory':
    case 'rule':
      out.push(
        {
          label: 'Review and shorten',
          detail: ctx.tokens !== undefined ? `≈ ${ctx.tokens.toLocaleString('en-US')} tokens at startup (estimate)` : 'Loads into every session',
          text: `${ref} This file loads into every Claude Code session${ctx.tokens !== undefined ? ` (about ${ctx.tokens.toLocaleString('en-US')} tokens)` : ''}. Cut it down to what Claude cannot learn by reading the code: remove duplication, generic advice and stale facts. Show the proposed version before saving.`,
        },
        {
          label: 'Find contradictions',
          detail: 'Against other CLAUDE.md files and rules',
          text: `${ref} Compare this with the other CLAUDE.md files and rules that apply in this project, including ~/.claude/CLAUDE.md. List instructions that contradict or duplicate each other, and say which one should win.`,
        },
        {
          label: 'Split into path-scoped rules',
          detail: 'Load instructions only where they apply',
          text: `${ref} Find instructions here that only matter for some files, such as tests, one package or one language, and move them into .claude/rules/*.md with a paths: pattern so they load only when relevant. Propose the split first.`,
        },
      );
      break;
    case 'setting':
      if (asset.name === 'permissions') {
        out.push(
          explain(ref, 'what Claude may do without asking in this project, given these permission rules and the other settings files'),
          {
            label: 'Tighten these permissions',
            detail: 'Deny → ask → allow, first match wins',
            text: `${ref} Review these permission rules. Rules are checked deny, then ask, then allow, and the first match wins. Find allow rules that are broader than needed and risky commands with no deny or ask rule, and propose a tighter set.`,
          },
        );
      } else {
        out.push(explain(ref, `what ${asset.name} controls here and which settings file's value actually applies`));
      }
      break;
    case 'plugin':
      out.push(explain(ref, `what the ${asset.name} plugin adds: its skills, commands, agents, hooks and MCP servers`));
      break;
    default:
      out.push(explain(ref, `what ${name} is for and how Claude Code uses it`));
  }
  return out;
}

function explain(ref: string, what: string): ItemPrompt {
  return { label: 'Explain', detail: 'What it is and when it is used', text: `${ref} Explain ${what}. Keep it short.` };
}

function improve(ref: string, what: string): ItemPrompt {
  return {
    label: 'Improve',
    detail: 'Clearer instructions, fewer surprises',
    text: `${ref} Improve ${what}: make the instructions unambiguous, remove anything Claude already knows, and keep its behaviour the same. Show the changes before saving.`,
  };
}
