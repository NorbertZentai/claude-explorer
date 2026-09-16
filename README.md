# Explorer for Claude Code

> **Unofficial.** A community extension, not affiliated with, endorsed by, or supported by Anthropic.
> "Claude" and "Claude Code" are trademarks of Anthropic.

See every Claude Code skill, slash command, subagent, hook, MCP server, plugin, rule and setting on
your machine — where each one comes from, what it does, and what is quietly broken.

**No account. No API key. No network.** It reads configuration files from disk, and changes or
runs something only when you pick an action and confirm it.

---

## Why

Claude Code spreads its configuration across a dozen locations: a managed directory, `~/.claude/`,
each project's `.claude/`, two settings files per scope, `.mcp.json`, and a plugin cache. Before
this, the only ways to see any of it were `claude mcp list`, typing `/`, and `ls` in a lot of
directories. Nothing showed the whole picture, and nothing told you where a given skill came from or
why the one you wrote is being shadowed by another.

## What it shows

Four levels, highest precedence first — **System**, **User**, **Plugins**, **Workspace**:

| Type | Read from |
|---|---|
| Policy | the managed settings directory, plus organization-pushed policy files |
| Settings | `settings.json` / `settings.local.json` — model, permissions, env (names only), status line |
| Skills · Commands · Subagents | `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md` at every scope |
| Rules | `rules/*.md`, including their `paths:` scoping |
| Hooks | user, project, project-local and managed settings, plus plugin `hooks/hooks.json` |
| MCP servers | project and plugin `.mcp.json`, with their approval state |
| LSP servers | plugin `.lsp.json` / `lspServers` |
| Output styles · Themes · Workflows | the directories Claude Code reads them from |
| Keybindings | `keybindings.json`, by context |
| Plugins | installed and enabled state |
| Plans | plan-mode output, **with an auto-deletion countdown**, and project plan conventions |
| Memory | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, auto-memory notes |

**Surfaces you are not using are shown too**, greyed out, with the path where they would live. The
sidebar is a map of what Claude Code can do, not only an inventory of what you happen to have.
Turn that off with `claudeExplorer.showUnusedSurfaces`.

## What it catches

Problems sort to the top of their group with a warning icon:

- an MCP server defined but never approved, or approved after being deleted
- a hook pointing at a script that no longer exists
- a plugin installed but not enabled
- a plan-mode file about to be auto-deleted by `cleanupPeriodDays`
- a skill with no description, which Claude can never trigger
- a settings file that is not valid strict JSON
- a `CLAUDE.md` that `@imports` a file that does not exist, or nests imports deeper than four hops

- a skill, command or subagent **overridden** by another with the same name, so it never runs.
  It is dimmed rather than flagged, with the rule that decided it in the tooltip

## Overview page

**Open Overview** (the dashboard icon in the view title) starts with summary cards (items, problems,
overridden, estimated startup tokens) and a count of every type per scope. Then, for the project you
pick:

- **Context budget**: roughly how many tokens of configuration load before your first prompt:
  every `CLAUDE.md` and the files it `@imports`, always-on rules, the first 200 lines or 25 KB of
  the auto-memory index, and the skill, command and subagent listings. Block-level HTML comments
  are left out, as Claude Code strips them, and skills hidden with `skillOverrides` or files
  excluded with `claudeMdExcludes` do not count. It is an estimate (characters ÷ 4), it flags
  files that are unusually large or over the documented 200 lines and skill descriptions that
  Claude Code truncates, and it says what it cannot measure, such as MCP tool definitions.
  - **Cost**: what that context costs per request at API list prices for the model in your
    settings (or `claudeExplorer.costModel`): the first request, which writes the prompt cache,
    and later ones that read it. A yardstick for comparing setups; subscriptions are not billed
    per token.
  - **Suggestions**: concrete savings with the estimated tokens per session and one button each:
    set a long or unused skill to `name-only`, shorten an oversized `CLAUDE.md` or memory index,
    move an always-on rule behind `paths:`, fix a truncated description. With
    `claudeExplorer.readTranscriptsForUsage` on, skills you have not used in 30 days are flagged.
- **Security**: a review of what sessions in the project may do, with severity: unrestricted
  `Bash`, wildcards before a subcommand or after a runner such as `npx *`, destructive or network
  commands allowed, fetching any URL, file access across your home directory,
  `bypassPermissions` and its skipped warning, auto-approved project MCP servers, credentials
  written literally into `.mcp.json` (by variable name only), project hooks that call `curl`, no
  sandbox, no deny rule for `.env`. Below it, every permission rule in evaluation order (deny →
  ask → allow) with its file, and a **tool call tester**: type `Bash(npm test)` or
  `Read(src/index.ts)` and see which rule decides it. Also in the Command Palette as *Test a Tool
  Call Against Permission Rules…*.
- **Effective settings**: the values a session really uses once managed, project-local, project
  and user settings are merged, with the file each value comes from. Lists such as
  `permissions.allow` are combined; any other value comes from the highest file, and the ones it
  replaces are shown struck through. `env` shows variable names only.
- **Hook timeline**: every hook that runs in the project, grouped by event in lifecycle order,
  with its matcher, where it is declared, and handlers that run only once because they are
  declared twice. Type a tool name to see which hooks fire for it. **Drag a hook** onto another
  event, or onto the user, project or project-local settings file, to move it there; **Edit…**
  changes its event, matcher or command, moves or deletes it. Hooks for one event run in
  parallel, so there is no order to rearrange within an event.
- **Recent changes**: configuration files changed in the last 14 days, by day, with items that
  appeared since this window opened marked as new.
- **Overrides** and **Problems**, with links to the files.

Every file name on the page opens that file beside the Overview. The page redraws whenever the tree
does, and follows your theme.

Right-click the Settings, Hooks, Memory, Skills or Rules group in the tree to jump straight to the
matching section.

## Status bar

For the project of the active editor: the startup context estimate (yellow above
`claudeExplorer.budgetWarnTokens`, red at twice that; hover for the cost and the largest items),
the number of problems, the number of configured MCP servers, and the permission mode, model and
output style a new session starts with when they are not the defaults. Each opens the matching
view. `claudeExplorer.statusBar` shows all, only the estimate, or nothing.

## Snippets

A second view, **Snippets**, keeps prompts and instructions you reuse, grouped by tag. Save a
selection from any editor (right-click → *Save Selection as Snippet*), edit a snippet's text in a
normal editor tab and save, and from its row: **Send to Claude Code** in a new terminal, **Copy**,
or **Insert into** your user or project `CLAUDE.md`, `CLAUDE.local.md`, an existing rule, or a new
rule with an optional `paths:` pattern (with the token cost in the confirmation). Import and export
as JSON. Snippets are stored in VS Code's storage for this extension on this machine.

## Using it

Click the icon in the activity bar.

- **The first row** shows the Claude Code account you are signed in with, or that none is. Nothing
  here needs one.
- **Click** an item to open its source; hooks and MCP servers open at the relevant line. Clicking a
  greyed "none" row opens the guide for that surface instead.
- **Hover** an item for its description, how to invoke it (with its `argument-hint` and
  `when_to_use`), its estimated token cost at startup and when used, the tools and MCP servers it
  needs, its enabled state or `skillOverrides` visibility, when the file last changed, why it is
  overridden or broken, and its full path.
- **The book icon** on any group opens a guide: what that surface is, where it lives, when it earns
  its place, and a **paste-ready prompt** for setting one up. Right-click for *Copy Setup Prompt*.
- **The `+` on Workspace** attaches another project folder, remembered per workspace; the **×** on an
  attached folder detaches it.
- **Group by scope or by type**, filter, and expand one level at a time. **Show Problems** in the
  Command Palette lists every problem in one searchable list.
- Refreshes on startup, on file change, and on demand — without ever emptying the view, and keeping
  whatever you had expanded.
- **Enable or disable** with the icon on a row, always through the setting Claude Code documents
  for it, never by renaming files: a plugin (`enabledPlugins` in `~/.claude/settings.json`), a
  project MCP server (`enabledMcpjsonServers` / `disabledMcpjsonServers`), your own skills and
  commands (`skillOverrides`), and `CLAUDE.md` files and rules (`claudeMdExcludes`). Project items
  are switched in the project's `.claude/settings.local.json`, user items in
  `~/.claude/settings.json`. **Set Visibility…** on a skill also offers `name-only` and
  `user-invocable-only`. Only that key changes, formatting is kept, and Undo works. Running Claude
  Code sessions may need a restart to notice.
- **Run** (▶) a skill or command: opens a terminal in its project and starts `claude "/deploy"`,
  asking for arguments when it has an `argument-hint`. **Assign Keybinding…** adds an entry to your
  VS Code `keybindings.json` that does the same; you type the key and save.
- **Clean Up Configuration…** (view title menu) lists hooks whose script is gone, approvals for MCP
  servers that no longer exist, plans past `cleanupPeriodDays`, empty folders, skill folders
  without `SKILL.md` and broken symlinks. Tick what goes; files move to the Trash and settings edits
  can be undone.
- **Get Started** (in the Command Palette) opens a short walkthrough.

### All actions at a glance

| Where | Actions |
|---|---|
| View title bar | Open Overview · Filter… / Clear Filter · Group by Type / Group by Scope · Refresh · Collapse All · Clean Up Configuration… |
| Icons on a type group | New… (`+`, where you can create) · What is this for? (book) · Open Folder |
| Icons on other rows | Run (▶ skills, commands) · Attach Folder (`+` on Workspace) · Detach Folder (× on an attached folder) · Set Up Claude Code Here… (project without `.claude`) · Add Permission Rule… (`permissions` row) · Change Setting… (model, output style, permissions) · Test MCP Server · Enable / Disable (plugins, project MCP servers, skills, commands, CLAUDE.md files, rules) |
| Right-click an item | Run in Claude Code · Assign Keybinding… · Open Source File · Reveal in File Explorer · Show in Overview · Compare with Overriding Item · Copy Path · Copy Invocation · Copy as @-Reference · Copy Prompt… · Copy claude mcp add Command · Enable / Disable · Set Visibility… · Why Isn't This in Effect? · Check Skill · Test MCP Server · Harden Security with Claude Code… · Edit Description… · Change Setting… · Copy to… · Rename… · Move to Trash |
| Right-click a type group | What is this for? · Copy Setup Prompt · Show Effective Settings (Settings, Policy) · Show Security Review (Settings, Policy, Hooks, MCP) · Show Hook Timeline (Hooks) · Show Context Budget (Memory, Skills, Rules) · Open Folder · New… · Draft a Skill with Claude Code… (Skills) · Add Permission Rule… (Settings) |
| Right-click a greyed "none" row | What is this for? · Copy Setup Prompt · New… |
| Right-click a scope heading, project or plugin | Export Report · Set Up Claude Code Here… · Set Up with Claude Code… (projects) · Personalise Claude Code… (User) · Detach Folder |
| Snippets view | New Snippet · Import / Export · on a snippet: Send to Claude Code · Copy · Insert into CLAUDE.md or Rule… · Edit Text · Rename · Tags · Delete |
| Command Palette | Open Overview · Show Effective Settings · Show Hook Timeline · Show Context Budget · Show Security Review · Show Recent Changes · Test a Tool Call Against Permission Rules… · Change Setting… · Clean Up Configuration… · Set Up with Claude Code… · Harden Security with Claude Code… · Draft a Skill with Claude Code… · Personalise Claude Code… · New Snippet · Show Problems · Attach Folder… · Filter… · Clear Filter · Group by Type / Scope · Refresh · Get Started |

Actions that change files appear only while `claudeExplorer.allowEditing` is on.

### Row actions

Icons at the end of a row:

- **New…** (`+`) on a type group, or on a greyed "none" row, creates a skill, command, subagent,
  rule or output style from a template with valid frontmatter and opens it with the description
  selected. For Hooks it asks for the event, the matcher and what to run, can create the script,
  and adds the entry to the settings file you pick. It warns when the name would override, or be
  overridden by, an existing one.
- **Set Up Claude Code Here…** on a project with no `.claude` yet: creates `.claude/settings.json`
  (with the JSON schema, for completion), an outline `CLAUDE.md`, and `.gitignore` lines for the
  private `settings.local.json` and `CLAUDE.local.md`. You choose which.
- **Open Folder** on a type group opens where those items live, such as `~/.claude/skills`.
- **Add Permission Rule** (`+`) on a `permissions` row: pick Allow, Ask or Deny, type the rule
  (`Bash(npm run *)`, `Read(./.env)`, `WebFetch(domain:example.com)`, `mcp__github`) and the
  settings file. Duplicates are caught, and rules that would never apply are refused.
- **Test MCP Server** on a stdio MCP server starts it, lists its tools, stops it, and reports how
  many tokens its tool definitions cost. The number is added to the context budget.

Right-click a row for:

- **Show in Overview**: jumps to the item on the Overview page and highlights it.
- **Copy as @-Reference**: `@.claude/skills/deploy/SKILL.md`, ready to paste into Claude.
- **Copy Prompt…**: a paste-ready prompt about that item, starting with its @-reference: explain
  it, improve a skill's description, review a hook for safety, tighten permissions, shorten a
  `CLAUDE.md` (with its token estimate). On a row with a problem or an override, the first choice
  is to fix it. Enter copies it; the ▶ button starts Claude Code with it. Prompts never include
  command lines or environment values.
- **Edit Description…** on your own skills, commands and subagents: change the one-line
  description in place, with a warning when a skill's listing would be truncated. **Change
  Setting…** on a `model`, `outputStyle` or `permissions` row does the same for that value.
- **Compare with Overriding Item** opens a diff against the item that wins over it.
- **Why Isn't This in Effect?** gathers every documented reason in one list: an override,
  `skillOverrides`, `claudeMdExcludes`, a `Skill(…)` or `Agent(…)` deny rule,
  `disable-model-invocation`, `paths:` on a rule, a disabled plugin, `disableAllHooks`, an
  unapproved MCP server, frontmatter problems.
- **Copy claude mcp add Command**: recreates the server elsewhere, with every environment and
  header value replaced by a `<value>` placeholder.
- **Check Skill**: checks a `SKILL.md` against the frontmatter reference: listing length, boolean
  and enum values, `agent` without `context: fork`, links to missing files, unknown keys.
- **Copy to…**, **Rename…** and **Move to Trash** for your own skills, commands, subagents,
  rules, output styles, workflows and themes. Copying warns when the copy would override something,
  or be overridden. Renaming a skill renames its folder, which is the command you type.
- **Export Report** on a scope heading, project or plugin: a Markdown summary of that
  configuration in a new, unsaved document.
- **Reveal in File Explorer**, **Copy Path** and, for skills, commands and plugin MCP servers,
  **Copy Invocation** (such as `/deploy` or `/plugin:skill`).

### Setting up with Claude Code

Instead of a template, these hand Claude Code a precise request so it can look at the project
first. Each can be copied or sent to a new Claude Code session in a terminal:

- **Set Up with Claude Code…** on a project: a `CLAUDE.md` with the build, test and architecture
  rules, a test-running skill, a formatter hook and permission rules, each shown before writing.
- **Harden Security with Claude Code…**: tighter permission rules, `.env` and `~/.ssh` denied,
  network commands blocked in favour of `WebFetch(domain:…)`, and a sandbox network allowlist.
- **Draft a Skill with Claude Code…** on Skills: give it a name and a sentence about what it
  should do; the prompt names the exact `SKILL.md` path and the frontmatter rules.
- **Personalise Claude Code…** on User: tick preferences (short answers, TypeScript, no Tailwind,
  answer language…) or type your own, merged into `~/.claude/CLAUDE.md`.

## Colours

The four scope headings (System, User, Plugins, Workspace) carry a soft tint, and type group icons
share one muted colour. Each has separate values for dark, light and high-contrast themes, so they
follow your theme. Turn tinting off with `claudeExplorer.colorful`, or change a colour in
`workbench.colorCustomizations`:

```json
"workbench.colorCustomizations": {
  "claudeExplorer.scope.system": "#E38B84",
  "claudeExplorer.scope.user": "#7FB3E6",
  "claudeExplorer.scope.plugin": "#B69AE0",
  "claudeExplorer.scope.workspace": "#86C48E",
  "claudeExplorer.groupIcon": "#8FA6BF"
}
```

## Scope

**A scope is a folder you opened.** Open one repo inside a monorepo and you get that repo, not its
siblings. Configuration inherited from parent folders is reported as a note rather than as extra
scopes. Anything else you want to see, you attach explicitly.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `claudeExplorer.defaultGrouping` | `scope` | Grouping on first open |
| `claudeExplorer.colorful` | `true` | Soft tint on scope headings and type group icons |
| `claudeExplorer.showUnusedSurfaces` | `true` | Greyed rows for surfaces you have not configured |
| `claudeExplorer.showPluginProvided` | `true` | Include plugin-provided assets |
| `claudeExplorer.extraProjectPaths` | `[]` | Extra folders, merged with the ones attached via `+` |
| `claudeExplorer.autoRefresh` | `true` | Watch config directories and refresh on change |
| `claudeExplorer.refreshDebounceMs` | `300` | Coalesce a burst of saves into one rebuild |
| `claudeExplorer.allowEditing` | `true` | Show actions that change files (new items, set up, enable/disable, visibility, descriptions, settings, permission rules, hooks, clean up, snippet inserts, copy, rename, trash); off means the extension never writes configuration |
| `claudeExplorer.statusBar` | `all` | Status bar items: `all`, `budget` (only the context estimate) or `off` |
| `claudeExplorer.budgetWarnTokens` | `10000` | Startup context estimate above which the status bar item turns yellow (red at twice this) |
| `claudeExplorer.costModel` | `auto` | Model whose API list prices the cost estimate uses; `auto` follows `model` in your settings |
| `claudeExplorer.inputPricePerMTok` | `0` | Override the input price (USD per million tokens) when list prices change; `0` uses the built-in list |
| `claudeExplorer.readTranscriptsForUsage` | `false` | Count skill, command and subagent use from local transcripts to flag unused skills; names and dates only |

## Privacy

- **No network.** Besides `vscode`, the source imports only `fs`, `os`, `path` and `crypto` (for
  the Overview page's content-security nonce), plus Microsoft's `jsonc-parser` for editing JSON.
  The built bundle contains no `http`, `https`, `net`, `fetch` or `XMLHttpRequest`.
- **Runs a process only on request.** `child_process` is used by one command, Test MCP Server,
  after a confirmation that shows the command line. It starts only stdio servers and stops them
  after they list their tools or after 20 seconds.
- **Starts Claude Code only in a terminal you can see.** Run, keybindings made with Assign
  Keybinding, Send to Claude Code on a snippet or prompt: each opens a new VS Code terminal and
  types `claude '<prompt>'` into it. The first time, a confirmation shows the command line; you can
  choose not to be asked again. A keybinding's `invocation` must be a slash command name, nothing
  else.
- **Reads transcripts only if you ask.** With `claudeExplorer.readTranscriptsForUsage` on, local
  transcripts under `~/.claude/projects/` are scanned for skill, command and subagent names and
  their dates. No message text is kept, and the counts stay in memory.
- **Writes only on request.** Enable/disable, visibility, descriptions, settings, adding a
  permission rule or hook, moving or editing hooks, clean up, inserting a snippet, copy, rename and
  Move to Trash each ask first; New… and Set Up Claude Code Here… create only what you name or tick.
  Set `claudeExplorer.allowEditing` to `false` and it never writes configuration. Assign
  Keybinding edits your open `keybindings.json` but leaves saving to you. Export Report opens an
  unsaved document and writes nothing. Snippets are saved in VS Code's storage for this extension.
- **No credential values.** MCP `env` blocks routinely hold API keys. Only variable *names* are ever
  displayed — never a value, not even masked or truncated, because a prefix is still a disclosure.
  One module is the sole path by which env data reaches the screen, and a test fails the build if
  anything secret-shaped appears in a rendered field. Effective settings show other values, but
  anything under a credential-like key, or shaped like a token, is masked.
- **No telemetry.**

## Requirements

VS Code 1.90 or later. Works in forks that implement the same extension API. Claude Code itself is
not required — without it the tree shows what each scope *would* contain.

## Contributing

```bash
npm install
npm run compile    # esbuild bundle
npm run typecheck
npm run audit      # headless run: counts, overrides, context budget, effective settings,
                   # hook timeline, problems, redaction check
                   # add --lint to check every skill, --report <user|folder> for the export,
                   # --prompts to generate every Copy Prompt text into the redaction check,
                   # --security [--permission "Bash(npm test)"], --cleanup (lists only),
                   # --deps, --recent, --usage (reads local transcripts)
npm run package    # -> explorer-for-claude-code-<version>.vsix
```

`npm run audit` runs the whole discovery layer in plain Node, because it imports no `vscode` API.
That is also what makes it unit-testable. `--kind <k>` prints individual rows and `--guide <k>`
renders one guide.

## License

MIT — see [LICENSE](LICENSE).
