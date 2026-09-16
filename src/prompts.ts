import { Asset } from './discovery/types';
import { DELIVER_READ_ONLY, framePrompt, PromptParts } from './promptFrame';

/**
 * Paste-ready prompts about one specific item, the per-row counterpart of the setup prompts
 * in guides.ts, plus the prompt-driven setup wizards. All follow the shape in promptFrame.ts:
 * goal, inspect first, requirements, constraints, verify, deliver.
 *
 * Built only from display fields (name, description, problem, override, hook event and
 * matcher) and what the user typed. Never from raw commands or env blocks, so nothing secret
 * can end up on the clipboard.
 */

/** Prompts offered by the Overview page, keyed by the id its buttons send. */
export const PAGE_PROMPTS = {
  securityHardening: framePrompt({
    goal: 'Tighten what Claude Code may do in this project without asking, and add OS-level protection where it is available.',
    inspect: [
      'Every settings file that applies: .claude/settings.json, .claude/settings.local.json, ~/.claude/settings.json, and managed settings if present.',
      'The commands this project really needs (package.json scripts, Makefile, CI) so safe ones stay allowed.',
      'Which secrets exist on disk (.env files, key files) by path only.',
    ],
    requirements: [
      'Rules are checked deny, then ask, then allow; the first match wins. Explain each change in those terms.',
      'Replace broad allow rules (Bash, Bash(*), wildcards before a subcommand, runners such as npx *) with the specific commands the project uses.',
      'Deny reading secrets: Read(./.env), Read(./.env.*), Read(~/.ssh/**) and any other secret paths you found.',
      'Deny Bash network tools (curl, wget) and route web access through WebFetch(domain:…) rules for the domains actually needed.',
      'Put team-wide rules in .claude/settings.json and personal ones in settings.local.json.',
      'If sandboxing is available on this OS, enable sandbox.enabled with sandbox.network.allowedDomains limited to localhost and the package registries this project uses.',
      'Remove skipDangerousModePermissionPrompt and enableAllProjectMcpServers if set, and explain the effect.',
    ],
    verify: [
      'List three commands that are now denied or asked and three that still run without asking.',
      'Tell me to run /permissions and /status to confirm the rules loaded.',
    ],
  }),
} as const;

/** Set up Claude Code for a project from what is in it. */
export function workspaceSetupPrompt(projectName: string): string {
  return framePrompt({
    goal: `Set up Claude Code for the ${projectName} project so sessions start with the right context, tools and guardrails.`,
    inspect: [
      'Build and dependency files that exist (package.json, Makefile, pyproject.toml, Cargo.toml, go.mod, pom.xml, build.gradle…), CI configuration and the directory layout.',
      'Existing Claude configuration: CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/ (settings, skills, rules, hooks) and .mcp.json.',
      'Formatter, linter and test tooling, and how a single test is run.',
    ],
    requirements: [
      'CLAUDE.md at the project root: build, test (including one file), lint and run commands; conventions that differ from language defaults; gotchas; @imports for longer docs. Under 200 lines, nothing Claude can read from the code.',
      'Path-scoped rules in .claude/rules/ for instructions that apply only to some files (tests, a package, a language).',
      'A project skill at .claude/skills/run-tests/SKILL.md that runs the relevant tests and summarises failures, with a description that starts with what it does and then "Use when …".',
      'If the project has a formatter, a PostToolUse hook on Edit|Write in .claude/settings.json that formats the edited file, never blocking and with a short timeout.',
      'Permission rules in .claude/settings.json: allow the safe commands you found (tests, lint, build), deny reading .env files and pushing to protected branches.',
      '.gitignore entries for .claude/settings.local.json and CLAUDE.local.md.',
    ],
    constraints: ['Keep existing configuration unless it is wrong; improve it rather than replacing it.'],
    verify: [
      'Tell me how to confirm each part: /context (memory and rules), /hooks, /permissions, and a prompt that should trigger the skill.',
    ],
    deliver: 'Show every file you plan to create or change, one at a time, and wait for my approval before writing each. Afterwards, list what was set up and how to test it.',
  });
}

/** A new skill drafted by Claude, written to an exact location. */
export function draftSkillPrompt(name: string, purpose: string, skillFile: string): string {
  return framePrompt({
    goal: `Write a new Claude Code skill named ${name} at ${skillFile}. What it should do: ${purpose.trim()}`,
    inspect: [
      'Existing skills and commands, so /' + name + ' does not override or get overridden by another.',
      'The project files, scripts and commands this procedure touches, so every step uses real paths.',
    ],
    requirements: [
      `The file is named exactly SKILL.md in a folder named ${name}; the folder name is the command.`,
      'Frontmatter description: what the skill does, then "Use when …" with concrete trigger situations. description plus when_to_use must stay under 1,536 characters, trigger situations first.',
      'Add argument-hint and use $ARGUMENTS or $0, $1 if it takes input.',
      'Pre-approve only the tools it really needs with allowed-tools, using narrow patterns such as Bash(npm test *).',
      'If it has side effects (deploys, commits, sends messages, changes data), set disable-model-invocation: true.',
      'Body: short numbered steps. If a step needs a script, put it next to SKILL.md and call it with ${CLAUDE_SKILL_DIR}.',
      'Keep SKILL.md under 500 lines and leave out anything Claude already knows.',
    ],
    verify: ['Give me three prompts that should load the skill, two that should not, and the /' + name + ' invocation to test it directly.'],
  });
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
  return framePrompt({
    goal: 'Record my personal working preferences in ~/.claude/CLAUDE.md so every Claude Code session follows them.',
    inspect: ['~/.claude/CLAUDE.md (create it if it does not exist), ~/.claude/rules/, and any output style set in ~/.claude/settings.json.'],
    requirements: [
      `Add these preferences: ${preferences.map((p) => `"${p.trim().replace(/\.?$/, '.')}"`).join(' ')}`,
      'Phrase each as a short, concrete, checkable instruction under a "Preferences" heading.',
      'Merge duplicates; where one contradicts something already there, ask me which one wins.',
      'If a preference is really about response format for every answer, say whether an output style would fit better.',
      'Keep the file under 200 lines.',
    ],
    verify: ['Tell me how to check with /context that the file loads.'],
  });
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

/** A prompt about one file: its @-reference first, so Claude reads it before anything else. */
function about(ref: string, label: string, detail: string, parts: PromptParts): ItemPrompt {
  return { label, detail, text: `${ref}\n\n${framePrompt(parts)}` };
}

export function promptsFor(asset: Asset, ctx: PromptContext): ItemPrompt[] {
  const { ref } = ctx;
  const name = asset.invocation ?? asset.name;
  const out: ItemPrompt[] = [];

  // What is wrong right now comes first: it is the most likely reason for asking.
  if (asset.problem) {
    out.push(
      about(ref, 'Fix this problem', asset.problem, {
        goal: `Fix the problem Explorer for Claude Code reports for ${name}: "${asset.problem}"`,
        inspect: ['The referenced file, and the settings or files it points to that the problem mentions.'],
        requirements: [
          'Find the root cause and explain it in one or two sentences before proposing a fix.',
          'Propose the smallest fix that follows the Claude Code documentation for this kind of configuration.',
        ],
        constraints: ['Change only this file unless the cause is elsewhere; then ask first.'],
        verify: ['Tell me how to confirm the problem is gone (a Claude Code command or a quick test).'],
      }),
    );
  }
  if (asset.overriddenBy) {
    const winner = ctx.winnerRef ?? asset.overriddenBy.name;
    out.push({
      label: 'Resolve the name conflict',
      detail: `Overridden by ${asset.overriddenBy.name} in ${asset.overriddenBy.scopeLabel}`,
      text: `${ref} ${winner}\n\n${framePrompt({
        goal: `Resolve the conflict: both files define ${name}, and the second one wins (${asset.overriddenBy.reason}).`,
        inspect: ['Both files in full, and their modification history if this is a git repository.'],
        requirements: [
          'Say whether one is an outdated copy of the other, or whether they do different things.',
          'Recommend one of: delete the loser, rename one of them, or merge them into the winner, with the reason.',
        ],
        deliver: 'Present the comparison and your recommendation, and do not change files until I choose.',
      })}`,
    });
  }

  switch (asset.kind) {
    case 'skill':
      out.push(
        explain(ref, `what the ${name} skill does, when Claude would load it automatically, what it needs to run, and what it can change`),
        about(ref, 'Improve the description', 'So Claude loads it at the right moments', {
          goal: `Rewrite the description of the ${name} skill so Claude loads it exactly when it is useful.`,
          inspect: ['The skill body, to see what it really does, and other skills whose descriptions overlap with this one.'],
          requirements: [
            'Lead with what it does, then "Use when …" with concrete situations and phrases a user would type.',
            'description plus when_to_use is cut at 1,536 characters in the listing: put the key use case first.',
            'Mention what it is not for when a neighbouring skill would be the better choice.',
          ],
          verify: ['List five prompts that should load it and five similar ones that should not.'],
          deliver: 'Show the new frontmatter and wait for my approval before saving.',
        }),
        about(ref, 'Tighten it', 'Shorter SKILL.md, detail moved into linked files', {
          goal: `Make the ${name} skill shorter and easier for Claude to follow without changing what it does.`,
          requirements: [
            'Keep SKILL.md under 500 lines; move long reference material into files next to it and link them.',
            'Remove anything Claude already knows (general programming advice, restated tool usage).',
            'Turn prose procedures into numbered steps with the exact commands and paths.',
          ],
          deliver: 'Propose the new structure and the diff first, and wait for my approval.',
        }),
        about(ref, 'Add supporting files and examples', 'Examples, reference and scripts next to SKILL.md', {
          goal: `Make the ${name} skill more reliable by adding supporting files where they help.`,
          inspect: ['What the steps need that is currently implicit: formats, templates, commands that are easy to get wrong.'],
          requirements: [
            'Add examples.md with one or two realistic input and output examples, if the output has a specific shape.',
            'Move repeated or fragile shell sequences into a script under scripts/ called with ${CLAUDE_SKILL_DIR}.',
            'Link every new file from SKILL.md with a sentence on when to read it.',
          ],
        }),
        about(ref, 'Suggest trigger tests', 'Prompts that should, and should not, load it', {
          goal: `Check whether the ${name} skill's description triggers at the right moments.`,
          requirements: [
            'Write five prompts that should load it and five similar ones that should not.',
            'For each case the current description would get wrong, explain why and suggest a wording change.',
          ],
          deliver: DELIVER_READ_ONLY,
        }),
      );
      break;
    case 'command':
      out.push(
        explain(ref, `what /${asset.name} does, what arguments it expects, and what it can change`),
        about(ref, 'Convert into a skill', 'Commands and skills share one system now', {
          goal: `Convert the /${asset.name} command into a skill at the same level, keeping /${asset.name} working.`,
          requirements: [
            `Create ${asset.name}/SKILL.md in the matching skills folder with the same body and frontmatter.`,
            'Add a description with "Use when …" so Claude can also pick it automatically, unless it has side effects (then disable-model-invocation: true).',
            'Keep $ARGUMENTS handling and argument-hint.',
          ],
          constraints: ['Delete the command file only after I confirm the skill works.'],
          verify: [`Tell me how to check that /${asset.name} now runs the skill.`],
        }),
        improve(ref, `the /${asset.name} command`),
      );
      break;
    case 'agent':
      out.push(
        explain(ref, `when Claude delegates to the ${asset.name} subagent, which tools and model it has, and what it returns`),
        about(ref, 'Review its tools', 'Least privilege', {
          goal: `Reduce the ${asset.name} subagent's tools to the smallest set its instructions actually need.`,
          requirements: [
            'Map each instruction in its body to the tools it needs.',
            'Point out every tool that can modify files, run commands or reach the network without a reason.',
            'If tools is omitted it inherits everything: propose an explicit allowlist.',
          ],
          deliver: 'Show the proposed tools line with a reason per tool, and wait for my approval.',
        }),
        about(ref, 'Improve its description', 'So Claude delegates to it at the right time', {
          goal: `Rewrite the ${asset.name} subagent's description so Claude delegates to it at the right moments and not otherwise.`,
          inspect: ['Other subagents whose descriptions overlap.'],
          requirements: [
            'Start with "Use this agent when …" and name concrete situations.',
            'Keep it short; combined subagent descriptions over 15,000 tokens trigger a warning.',
          ],
          verify: ['Give two requests that should go to it and one that should not.'],
        }),
        about(ref, 'Add persistent memory', 'Let it learn conventions across sessions', {
          goal: `Give the ${asset.name} subagent persistent memory so it builds up project knowledge.`,
          requirements: [
            'Add memory: project (shared through git), local (private) or user (all projects), and explain the choice.',
            'Add instructions to consult memory before starting and to record confirmed conventions, one line each.',
          ],
        }),
      );
      break;
    case 'hook': {
      const when = asset.hook
        ? `on ${asset.hook.event}${asset.hook.matcher ? ` for tools matching ${asset.hook.matcher}` : ''}`
        : 'when it fires';
      out.push(
        explain(ref, `what the "${asset.name}" hook does ${when}, whether it can block, and what happens when it exits non-zero`),
        about(ref, 'Review for safety', 'Injection, blocking, timeouts', {
          goal: `Review the "${asset.name}" hook, which runs ${when}, for safety and reliability.`,
          requirements: [
            'Check for shell injection from the event JSON on stdin, unquoted variables and paths.',
            'Check for commands that could hang without a timeout, or slow work on a frequent event.',
            'Check exit codes: exit 2 blocks and shows stderr to Claude; any other non-zero is a non-blocking error.',
            'Check for network calls or data it sends outside the machine.',
          ],
          deliver: 'List issues by severity with a concrete fix for each. Do not change files until I pick which to fix.',
        }),
        about(ref, 'Debug why it does not fire', 'Matcher, event, path and permissions', {
          goal: `Find out why the "${asset.name}" hook, which should run ${when}, does not seem to run.`,
          inspect: ['Every settings file that declares hooks, and disableAllHooks at any level.'],
          requirements: [
            'Check the event name spelling, the matcher (exact name or list versus regex), and the if field.',
            'Check the script path, quoting, $CLAUDE_PROJECT_DIR use and execute permission.',
            'Check whether folder trust or allowManagedHooksOnly could stop it.',
          ],
          verify: ['Tell me how to verify each step: /hooks, claude --debug, and a way to trigger the event.'],
          deliver: 'Explain the most likely cause first, then propose the fix and wait for my approval.',
        }),
      );
      break;
    }
    case 'mcp':
      out.push(
        explain(ref, `what the ${asset.name} MCP server gives Claude, which tools it exposes, and when Claude should use it`),
        about(ref, 'Review the configuration', 'Secrets and risky access', {
          goal: `Review how the ${asset.name} MCP server is configured.`,
          requirements: [
            'Point out credentials written as literal values that should use ${VAR} expansion or OAuth.',
            'Point out access broader than needed (write access, whole filesystem, admin tokens).',
            'Say whether it belongs in project (.mcp.json), user or local scope, and whether its approval state is right.',
          ],
          deliver: 'Report first, never printing secret values, and propose fixes to approve one by one.',
        }),
        about(ref, 'Trim the tools it exposes', 'Less context, less risk', {
          goal: `Reduce the context and risk of the ${asset.name} MCP server's tools.`,
          inspect: ['Its tool list (/mcp) and which tools this project actually uses.'],
          requirements: [
            'Suggest permission deny rules (mcp__<server>__<tool>) for tools that are risky or never needed.',
            'If the server supports options to limit its toolset or make it read-only, show them.',
          ],
        }),
      );
      break;
    case 'memory':
    case 'rule':
      out.push(
        about(ref, 'Review and shorten', ctx.tokens !== undefined ? `≈ ${ctx.tokens.toLocaleString('en-US')} tokens at startup (estimate)` : 'Loads into every session', {
          goal: `Cut this file down to what Claude cannot learn by reading the code${ctx.tokens !== undefined ? `; it costs about ${ctx.tokens.toLocaleString('en-US')} tokens in every session` : ''}.`,
          inspect: ['The code and configuration it describes, to find statements that are stale or derivable.'],
          requirements: [
            'Remove duplication, generic advice, directory listings and stale facts.',
            'Keep commands, conventions that differ from defaults, pitfalls and the reasons behind decisions.',
            'Aim for under 200 lines; estimate the tokens saved (characters ÷ 4).',
          ],
          deliver: 'Show the proposed version as a diff and wait for my approval before saving.',
        }),
        about(ref, 'Find contradictions', 'Against other CLAUDE.md files and rules', {
          goal: 'Find instructions in this file that contradict or duplicate other memory files that load in this project.',
          inspect: ['~/.claude/CLAUDE.md, parent-folder and project CLAUDE.md files, CLAUDE.local.md and .claude/rules.'],
          requirements: ['For each contradiction or duplicate, quote both, name the files, and say which one should win and why.'],
          deliver: DELIVER_READ_ONLY,
        }),
        about(ref, 'Split into path-scoped rules', 'Load instructions only where they apply', {
          goal: 'Move instructions that only matter for some files into path-scoped rules, so they load only when relevant.',
          requirements: [
            'Find instructions specific to tests, one package, one language or one directory.',
            'Move each group into .claude/rules/<topic>.md with a paths: glob matching exactly those files.',
            'Estimate the tokens no longer loaded in every session.',
          ],
          deliver: 'Propose the split (rule files, globs, moved lines) first and wait for my approval.',
        }),
      );
      break;
    case 'setting':
      if (asset.name === 'permissions') {
        out.push(
          explain(ref, 'what Claude may do without asking in this project, given these permission rules and the other settings files that apply'),
          about(ref, 'Tighten these permissions', 'Deny → ask → allow, first match wins', {
            goal: 'Tighten these permission rules without breaking the commands this project needs.',
            inspect: ['The other settings files that apply, and the commands the project really uses.'],
            requirements: [
              'Rules are checked deny, then ask, then allow; the first match wins.',
              'Find allow rules broader than needed, including wildcards before a subcommand and runners such as npx *.',
              'Find risky commands and secret paths with no deny or ask rule.',
            ],
            deliver: 'Propose the new rule set with a reason per change and wait for my approval.',
          }),
        );
      } else {
        out.push(explain(ref, `what ${asset.name} controls here and which settings file's value actually applies`));
      }
      break;
    case 'plugin':
      out.push(
        explain(ref, `what the ${asset.name} plugin adds: its skills, commands, agents, hooks, MCP and LSP servers`),
        about(ref, 'Audit what it adds and its context cost', 'Keep, trim or disable', {
          goal: `Decide whether the ${asset.name} plugin earns its place in my setup.`,
          inspect: ['Everything the plugin installs, and what I already have that overlaps.'],
          requirements: [
            'List each component with what it does and whether it adds startup context (skill listings, MCP tools).',
            'Point out hooks or MCP servers that run code or reach the network.',
            'Recommend keep, disable for some projects, or uninstall, with the /plugin command to do it.',
          ],
          deliver: DELIVER_READ_ONLY,
        }),
      );
      break;
    default:
      out.push(explain(ref, `what ${name} is for and how Claude Code uses it`));
  }
  return out;
}

function explain(ref: string, what: string): ItemPrompt {
  return {
    label: 'Explain',
    detail: 'What it is and when it is used',
    text: `${ref} Explain ${what}. Keep it short, cite the lines you rely on, and do not change any files.`,
  };
}

function improve(ref: string, what: string): ItemPrompt {
  return about(ref, 'Improve', 'Clearer instructions, fewer surprises', {
    goal: `Improve ${what} without changing its behaviour.`,
    requirements: [
      'Make the instructions unambiguous: exact commands, paths and the expected output.',
      'Remove anything Claude already knows.',
      'Add argument-hint and frontmatter that are missing.',
    ],
    deliver: 'Show the diff and wait for my approval before saving.',
  });
}
