import { AssetKind } from './discovery/types';

/**
 * A short explainer per surface: what it is, when it earns its place, and a prompt you
 * can paste into Claude Code to set one up.
 *
 * The prompt is the point. Knowing that "output styles exist" is not actionable; having a
 * sentence you can hand to Claude is. Each one is written to be pasted verbatim.
 */

export interface Guide {
  title: string;
  /** One paragraph: what it is and what it is for. */
  what: string;
  /** Where the files live. */
  where: string[];
  /** When it is the right tool, and when it is not. */
  use: string[];
  /** Ordered steps, for surfaces that have an actual workflow rather than a file format. */
  workflow?: string[];
  /** Settings keys that govern this surface: [key, what it does]. */
  settings?: Array<[string, string]>;
  /** The surprising parts -- the things that cost an afternoon if you do not know them. */
  gotchas?: string[];
  /** Paste-ready prompt. */
  prompt: string;
  docs: string;
}

const D = 'https://code.claude.com/docs/en';

export const GUIDES: Record<AssetKind, Guide> = {
  skill: {
    title: 'Skills',
    what: 'A folder with a `SKILL.md` that teaches Claude a procedure — how your team does code review, how to write a commit message, how to run a release. Claude loads it automatically when the description matches what you asked for, so it behaves like knowledge rather than a command you have to remember.',
    where: ['`~/.claude/skills/<name>/SKILL.md` — every project', '`.claude/skills/<name>/SKILL.md` — this project only', 'plugins ship their own, invoked as `/plugin:skill`'],
    use: [
      'Use when the same instructions would otherwise be repeated in every conversation.',
      'The `description` field is what triggers it — write it as "do X. Use when Y", not as a title.',
      'Keep it short. A skill nobody can read in a minute is a document, not a skill.',
    ],
    prompt: 'Create a skill called <name> that <does what>. It should trigger when I <situation>. Put it at user level so it works in every project, and follow the house style of my existing skills.',
    docs: `${D}/skills`,
  },
  command: {
    title: 'Slash commands',
    what: 'A single markdown file that becomes `/name`. The older, simpler form of a skill: you invoke it explicitly instead of Claude deciding. `$ARGUMENTS` in the body is replaced by whatever you type after the command.',
    where: ['`~/.claude/commands/<name>.md`', '`.claude/commands/<name>.md`', 'plugins: `/plugin:command`'],
    use: [
      'Use when you always want to trigger it yourself, not have Claude choose.',
      'The docs now recommend skills for new work — commands remain for the explicit-invocation case.',
      'No frontmatter is required; the first line becomes the description.',
    ],
    prompt: 'Create a slash command /<name> that <does what>, taking $ARGUMENTS as <the input>. Keep it to one file under ~/.claude/commands/.',
    docs: `${D}/slash-commands`,
  },
  agent: {
    title: 'Subagents',
    what: 'A separate Claude with its own prompt, its own tool list and its own context window. Work sent to it does not fill up your conversation, and you can take tools away — an agent with no Edit tool physically cannot write files, no matter what it is asked.',
    where: ['`~/.claude/agents/*.md`', '`.claude/agents/*.md`', 'plugins: `agents/*.md`'],
    use: [
      'Use for searching and reviewing, where the output is a conclusion and the input is large.',
      'Restricting `tools:` is the real feature — it turns a rule into a mechanism.',
      'Needs `name` and `description`; a file whose `---` is not on line 1 is silently ignored.',
    ],
    prompt: 'Create a subagent called <name> that <does what>. Give it only the tools it needs (<list>) so it cannot <thing to prevent>. Write the description so Claude knows when to delegate to it.',
    docs: `${D}/sub-agents`,
  },
  rule: {
    title: 'Rules',
    what: 'Markdown that loads like `CLAUDE.md`, but can be limited to files matching a glob through a `paths:` field. A rule for `**/*.tf` only costs context when Terraform is actually in play.',
    where: ['`~/.claude/rules/*.md`', '`.claude/rules/*.md` (recursive)'],
    use: [
      'Use when an instruction applies to some files and would be noise everywhere else.',
      'Without `paths:` it loads at launch, exactly like CLAUDE.md — that is the wasteful case.',
      'Good for language conventions, test requirements, per-directory ownership.',
    ],
    prompt: 'Create a rule that applies only to <glob> and says <the instruction>. Put it in .claude/rules/ with a paths: field so it does not load for unrelated files.',
    docs: `${D}/memory`,
  },
  outputStyle: {
    title: 'Output styles',
    what: 'Replaces how Claude writes — its tone, structure and level of explanation — without touching what it knows. Built-ins are Default, Proactive, Concise, Explanatory and Learning.',
    where: ['`~/.claude/output-styles/*.md`', '`.claude/output-styles/*.md`', 'selected with the `outputStyle` setting'],
    use: [
      'Use to make answers consistently shorter, or consistently more explanatory.',
      '`keep-coding-instructions: true` keeps the engineering behaviour and changes only the prose.',
      'A style is not the place for project facts — that is what CLAUDE.md is for.',
    ],
    prompt: 'Create an output style called <name> that makes answers <how>. Keep the coding instructions intact, and set it as my default in settings.',
    docs: `${D}/output-styles`,
  },
  theme: {
    title: 'Themes',
    what: 'Terminal colours for Claude Code, as a JSON file with a base theme and overrides. Cosmetic, and the only surface here that changes nothing about behaviour.',
    where: ['`~/.claude/themes/<name>.json`'],
    use: ['Use if the built-in themes clash with your terminal.', 'Shape is `{ name, base, overrides }`.'],
    prompt: 'Create a theme called <name> based on <light|dark> that overrides <which colours>, and put it in ~/.claude/themes/.',
    docs: `${D}/plugins-reference`,
  },
  workflow: {
    title: 'Workflows',
    what: 'A JavaScript file that orchestrates several agents deterministically — fan out across N items, verify each result, merge. Unlike asking Claude to "use subagents", the sequence is code, so it runs the same way every time.',
    where: ['`~/.claude/workflows/*.js`', '`.claude/workflows/*.js`', 'plugins: `workflows/`'],
    use: [
      'Use for repeatable multi-agent work: reviewing every changed file, checking N repos.',
      'Costs a lot of tokens — it spawns real agents. Not for one-off questions.',
      'Gated by `enableWorkflows` / `disableWorkflows`.',
    ],
    prompt: 'Create a workflow that <does what> by fanning out over <the items> and then <verifying/merging>. Keep it under <n> agents.',
    docs: `${D}/workflows`,
  },
  hook: {
    title: 'Hooks',
    what: 'A command Claude Code runs automatically at a defined moment — before a tool call, after an edit, at session start, when it stops. This is the only way to enforce something rather than request it: a `PreToolUse` hook can refuse a tool call outright.',
    where: ['`hooks` in any `settings.json` or `settings.local.json`', 'plugins: `hooks/hooks.json`', 'also declarable in skill and subagent frontmatter'],
    use: [
      'Use for guardrails and automation that must not depend on Claude remembering.',
      '33 events exist; the common ones are PreToolUse, PostToolUse, SessionStart, Stop.',
      'Handlers can be `command`, `http`, `mcp_tool`, `prompt` or `agent` — not only shell.',
      'A hook that blocks should exit fast; the timeout is in seconds.',
    ],
    prompt: 'Add a hook that runs <when> and <does what>. Use the <event> event, keep it non-blocking, and put the script in .claude/hooks/ with shellcheck-clean bash.',
    docs: `${D}/hooks`,
  },
  mcp: {
    title: 'MCP servers',
    what: 'External tool providers. An MCP server gives Claude real access to a system — your repos, a database, a docs site — instead of guessing from training data. Scopes: project (`.mcp.json`, shared with the team), user and local (in `~/.claude.json`).',
    where: ['`.mcp.json` in the project root', '`~/.claude.json` for user and local scope', 'plugins can ship one'],
    use: [
      'Use when Claude needs live data it cannot read from disk.',
      'Project servers stay inert until approved in `settings.local.json`.',
      'Each server adds tool definitions to every request — add them deliberately.',
      'Never put a credential in `env` if you can use a CLI login instead.',
    ],
    prompt: 'Add the <name> MCP server to this project at project scope, authenticating through <method>. Do not put any secret in the config file.',
    docs: `${D}/mcp`,
  },
  lsp: {
    title: 'LSP servers',
    what: 'A language server a plugin provides, giving Claude real go-to-definition and find-references instead of text search. Installed through LSP plugins such as `pyright-lsp` or `typescript-lsp`.',
    where: ['plugin `.lsp.json`, or `lspServers` in `plugin.json`', 'some declare it only in the marketplace catalog'],
    use: [
      'Use when Claude keeps guessing at symbols in a large codebase.',
      'Install the one matching your language; there is nothing to configure by hand.',
    ],
    prompt: 'Install the LSP plugin for <language> from the official marketplace and confirm it is active.',
    docs: `${D}/plugins-reference`,
  },
  plugin: {
    title: 'Plugins',
    what: 'A bundle that can ship skills, commands, subagents, hooks, MCP servers, output styles and LSP servers together. Installed from a marketplace; the official one carries a few hundred.',
    where: ['`~/.claude/plugins/`', 'enabled per-plugin via `enabledPlugins` in settings'],
    use: [
      'Use to get a whole capability at once instead of writing five files.',
      'Installed and enabled are separate — a plugin can be present and switched off.',
      'Everything a plugin adds shows up in this tree under its own name.',
    ],
    prompt: 'Install the <name> plugin from the official marketplace, then show me what it adds.',
    docs: `${D}/plugins`,
  },
  keybinding: {
    title: 'Keybindings',
    what: 'The full key map for the Claude Code TUI, one file, user scope only. Each context (Chat, Transcript, ModelPicker…) has its own chord table; setting a binding to `null` unbinds it. Hot-reloaded.',
    where: ['`~/.claude/keybindings.json`'],
    use: [
      'Use to rebind a chord that clashes with your terminal or multiplexer.',
      'Ctrl+C, Ctrl+D, Ctrl+M, Ctrl+I, Ctrl+H and Caps Lock are reserved.',
    ],
    prompt: 'Rebind <key> in the <context> context to <action> in ~/.claude/keybindings.json, and tell me what it was bound to before.',
    docs: `${D}/keybindings`,
  },
  setting: {
    title: 'Settings',
    what: 'The JSON that configures everything else — model, permissions, environment variables, status line, output style. Four files with a strict precedence: managed beats project-local, which beats shared project, which beats user.',
    where: ['`~/.claude/settings.json`', '`.claude/settings.json` (committed)', '`.claude/settings.local.json` (private)'],
    use: [
      'Put team conventions in `.claude/settings.json`, personal ones in `settings.local.json`.',
      'Permissions evaluate deny → ask → allow, first match wins — an allow cannot except a deny.',
      'Strict JSON: a comment or trailing comma breaks the whole file silently.',
    ],
    prompt: 'Add <setting> to my <user|project> settings so that <effect>. Show me the precedence implication if it is already set somewhere else.',
    docs: `${D}/settings`,
  },
  policy: {
    title: 'Policy',
    what: 'Settings you did not choose. Either an administrator deployed `managed-settings.json` to the machine, or your organization pushed limits down from the Claude service. Managed settings outrank every local file and cannot be overridden.',
    where: ['`C:\\Program Files\\ClaudeCode\\` (Windows), `/etc/claude-code/` (Linux), `/Library/Application Support/ClaudeCode/` (macOS)', '`~/.claude/policy-limits.json`, `~/.claude/remote-settings.json` — org-pushed, replaced on sync'],
    use: [
      'Read-only. Editing the org-pushed files does nothing — they are overwritten.',
      'If a setting of yours is being ignored, look here first.',
    ],
    prompt: 'Check whether any managed or organization policy is overriding my <setting>, and explain which file wins.',
    docs: `${D}/managed-settings`,
  },
  plan: {
    title: 'Plans',
    what:
      "Two unrelated things share this name. `~/.claude/plans/` is Claude Code's own store: in plan " +
      'mode Claude researches without editing, writes a plan to a file on disk, and asks you to ' +
      'approve it before it may touch anything. That file is not a transcript — Claude Code ' +
      '**re-injects it from disk after every compaction**, so the plan survives when the ' +
      'conversation history does not, and editing the file mid-session changes what Claude is ' +
      'working from. A `plans/` folder inside a project is a different thing entirely: no official ' +
      'page reads it, so where one exists it is a team convention, not a Claude Code feature.',
    where: [
      '`~/.claude/plans/` — the default store. Flat, and shared across **every** project.',
      'Filenames are generated: your prompt slugged, plus two random words (`fix-auth-race-snug-otter.md`).',
      '`<project>/.claude/plans/` — only a convention. Claude Code writes there only if `plansDirectory` says so.',
      '`plansDirectory` resolves **relative to the project root**; a path resolving outside it is ignored and the default is kept.',
    ],
    use: [
      'Use it before any change large enough that doing it wrong costs more than planning it.',
      'Read the plan before approving. `Ctrl+G` opens it in your editor so you can change it first.',
      'A plan is also the cheapest handover artifact you have — it says why, not just what.',
      'There is no plan browser, no reuse, no library. Plans are files; treat them as such.',
    ],
    workflow: [
      'Enter with `Shift+Tab`, or `/plan`, or `/plan <task>` to enter and start immediately. From the CLI: `claude --permission-mode plan`.',
      'Claude reads files and runs read-only commands, and writes the plan to disk. Edits stay blocked.',
      'Press `Ctrl+G` to open the proposed plan in your editor and change it before approving.',
      'Approve with **Yes, and use auto mode**, or **Yes, manually approve edits**, or reject with **No, keep planning** and say what to change.',
      '`Shift+Tab` again leaves plan mode without approving anything.',
    ],
    settings: [
      ['plansDirectory', 'Where plan files are written. Relative to the project root; settable in any settings file. Unset means `~/.claude/plans`.'],
      ['cleanupPeriodDays', 'How long files under `~/.claude/` survive. Default 30 — and the plan store is on that list.'],
      ['permissions.defaultMode', 'Set to `plan` to start every session of a project in plan mode.'],
      ['useAutoModeDuringPlan', 'Default true. Lets the classifier vet shell commands during planning instead of prompting. User/local/managed only — a repository cannot turn it off for you.'],
      ['showClearContextOnPlanAccept', 'Default false. Adds an approval option that clears the conversation and implements from the plan alone — useful when planning ate the context window.'],
    ],
    gotchas: [
      '**Plan files are deleted automatically.** Anything under `~/.claude/` older than `cleanupPeriodDays` (default 30) is removed, and `~/.claude/plans/` is explicitly on that list. Nothing warns you — which is why the rows here carry an expiry countdown.',
      '**`<project>/.claude/plans/` is not official.** No Claude Code page reads it. If your team relies on it, only the team enforces it.',
      '**`plansDirectory` cannot point outside the project.** No absolute paths, no `~`, no vault outside the repo. The documented example is `"./plans"`.',
      'In an **interactive terminal where bypass permissions are available**, plan mode does not actually block edits — Claude is only instructed not to. The blocks are real in `-p` runs, the Agent SDK, and the VS Code chat panel.',
      'Each conversation gets its own plan file: `/clear` starts a fresh one, and a `/fork` no longer shares the original.',
      'Approving a plan names the session after it, unless you already named it.',
      'The VS Code extension does not read a project’s `defaultMode` for its starting mode — set `claudeCode.initialPermissionMode` in your VS Code settings instead.',
    ],
    prompt:
      'Copy the plan <which one> out of ~/.claude/plans into <where it should live permanently>, ' +
      'give it a readable filename, and summarise what it was about in two sentences.',
    docs: `${D}/permission-modes`,
  },
  memory: {
    title: 'Memory',
    what: 'The instructions Claude loads before you say anything. `CLAUDE.md` at user and project level, `CLAUDE.local.md` for private notes, plus the auto-memory notes Claude writes about a project itself.',
    where: ['`~/.claude/CLAUDE.md` — every project', '`CLAUDE.md` / `.claude/CLAUDE.md` — this project', '`CLAUDE.local.md` — private, not committed', '`~/.claude/projects/<slug>/memory/`'],
    use: [
      'Project facts and conventions go here; work method and preferences go at user level.',
      'Everything here costs context on every single request — keep it tight.',
      'Files concatenate from the root down; `@path` imports work up to four hops.',
    ],
    prompt: 'Record that <fact> in the right memory level, and tell me which level you chose and why before writing it.',
    docs: `${D}/memory`,
  },
};

export function renderGuide(kind: AssetKind): string {
  const g = GUIDES[kind];
  const lines: string[] = [
    `# ${g.title}`,
    '',
    g.what,
    '',
    '## Where it lives',
    '',
    ...g.where.map((w) => `- ${w}`),
    '',
    '## How to use it',
    '',
    ...g.use.map((u) => `- ${u}`),
  ];

  if (g.workflow) {
    lines.push('', '## The workflow', '', ...g.workflow.map((w, i) => `${i + 1}. ${w}`));
  }
  if (g.settings) {
    lines.push(
      '',
      '## Settings that govern it',
      '',
      '| Key | What it does |',
      '|---|---|',
      ...g.settings.map(([k, v]) => `| \`${k}\` | ${v} |`),
    );
  }
  if (g.gotchas) {
    lines.push('', '## Worth knowing', '', ...g.gotchas.map((x) => `- ${x}`));
  }

  lines.push(
    ...[
    '',
    '## Prompt you can paste',
    '',
    '```text',
    g.prompt,
    '```',
    '',
    'Replace the `<…>` parts. Claude Code will ask before writing anything.',
    ],
  );
  if (g.docs) {
    lines.push('', '---', '', `Official documentation: ${g.docs}`);
  }
  return lines.join('\n');
}
