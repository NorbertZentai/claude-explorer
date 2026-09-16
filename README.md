# Explorer for Claude Code

> **Unofficial.** A community extension, not affiliated with, endorsed by, or supported by Anthropic.
> "Claude" and "Claude Code" are trademarks of Anthropic.

See every Claude Code skill, slash command, subagent, hook, MCP server, plugin, rule and setting on
your machine — where each one comes from, what it does, and what is quietly broken.

**No account. No API key. No network.** It reads configuration files from disk and nothing else.

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

## Using it

Click the icon in the activity bar.

- **Click** an item to open its source; hooks and MCP servers open at the relevant line.
- **The book icon** on any group opens a guide: what that surface is, where it lives, when it earns
  its place, and a **paste-ready prompt** for setting one up. Right-click for *Copy Setup Prompt*.
- **The `+` on Workspace** attaches another project folder, remembered per workspace.
- **Group by scope or by type**, filter, and expand one level at a time.
- Refreshes on startup, on file change, and on demand — without ever emptying the view, and keeping
  whatever you had expanded.

## Scope

**A scope is a folder you opened.** Open one repo inside a monorepo and you get that repo, not its
siblings. Configuration inherited from parent folders is reported as a note rather than as extra
scopes. Anything else you want to see, you attach explicitly.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `claudeExplorer.defaultGrouping` | `scope` | Grouping on first open |
| `claudeExplorer.showUnusedSurfaces` | `true` | Greyed rows for surfaces you have not configured |
| `claudeExplorer.showPluginProvided` | `true` | Include plugin-provided assets |
| `claudeExplorer.extraProjectPaths` | `[]` | Extra folders, merged with the ones attached via `+` |
| `claudeExplorer.autoRefresh` | `true` | Watch config directories and refresh on change |
| `claudeExplorer.refreshDebounceMs` | `300` | Coalesce a burst of saves into one rebuild |

## Privacy

- **No network.** The source imports exactly four modules — `fs`, `os`, `path` and `vscode`. The
  built bundle contains no `http`, `https`, `net`, `fetch`, `XMLHttpRequest` or `child_process`.
- **No writes.** It opens files and copies paths. It never modifies Claude configuration.
- **No credential values.** MCP `env` blocks routinely hold API keys. Only variable *names* are ever
  displayed — never a value, not even masked or truncated, because a prefix is still a disclosure.
  One module is the sole path by which env data reaches the screen, and a test fails the build if
  anything secret-shaped appears in a rendered field.
- **No telemetry.**

## Requirements

VS Code 1.90 or later. Works in forks that implement the same extension API. Claude Code itself is
not required — without it the tree shows what each scope *would* contain.

## Contributing

```bash
npm install
npm run compile    # esbuild bundle
npm run typecheck
npm run audit      # headless discovery run: counts, problems, redaction check
npm run package    # -> claude-explorer-<version>.vsix
```

`npm run audit` runs the whole discovery layer in plain Node, because it imports no `vscode` API.
That is also what makes it unit-testable. `--kind <k>` prints individual rows and `--guide <k>`
renders one guide.

## License

MIT — see [LICENSE](LICENSE).
