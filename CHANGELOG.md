# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

Initial version.

### Added

- Read-only sidebar listing Claude Code configuration across the System, User, Plugins and
  Workspace scopes: policy, settings, skills, commands, subagents, rules, hooks, MCP and LSP
  servers, output styles, themes, workflows, keybindings, plugins, plans and memory.
- Greyed placeholders for surfaces a scope supports but has nothing configured for
  (`claudeExplorer.showUnusedSurfaces`).
- Problem detection: unapproved or stale MCP approvals, hooks pointing at missing scripts,
  installed-but-disabled plugins, plans about to be auto-deleted, skills without a
  description, and settings files that are not valid strict JSON.
- Per-surface guides with a paste-ready setup prompt.
- Grouping by scope or by type, filtering, and attaching extra project folders.
- Soft tints on scope headings and type group icons (`claudeExplorer.colorful`), adjustable via
  `workbench.colorCustomizations`.
- Automatic refresh on file change that keeps the expanded state.
- Override detection: skills, commands and subagents shadowed by another with the same name are
  dimmed, following Claude Code's documented precedence per project.
- Overview page with a context budget estimate, effective (merged) settings with their source file,
  a hook timeline in lifecycle order, overrides and problems.
- Enable/disable for plugins and project MCP servers, with confirmation and undo
  (`claudeExplorer.allowEditing`).
- Get Started walkthrough.
- Row actions: Open Folder, Add Permission Rule, Test MCP Server (inline); Show in Overview,
  Copy as @-Reference, Copy claude mcp add Command, Check Skill, Copy to…, Rename…, Move to Trash
  and Export Report (context menu).
- New… from a template for skills, commands, subagents, rules, output styles and hooks; Set Up
  Claude Code Here… for projects without `.claude`; Copy Prompt… with item-specific prompts.
- Context budget counts files pulled in with `@import` (up to four hops), leaves out block-level
  HTML comments, applies the 25 KB limit of the auto-memory index, skips skills hidden with
  `skillOverrides` and files excluded with `claudeMdExcludes`, and warns about a `CLAUDE.md` over
  the documented 200 lines.
- Cost estimate for the startup context at API list prices (`claudeExplorer.costModel`,
  `claudeExplorer.inputPricePerMTok`), on the Overview and in the status bar tooltip.
- Budget suggestions with estimated savings and one action each; with the opt-in
  `claudeExplorer.readTranscriptsForUsage`, skills unused for 30 days are flagged.
- Security section on the Overview: risky allow rules, `bypassPermissions`, auto-approved MCP
  servers, credentials written into `.mcp.json` (names only), network calls in project hooks,
  missing sandbox and `.env` protection, plus every permission rule in evaluation order.
- Tool call tester: which permission rule decides `Bash(npm test)` and the like, on the Overview
  and as Test a Tool Call Against Permission Rules….
- Recent changes section: configuration modified in the last 14 days, and items new this session.
- Tooltips show the estimated token cost at startup and when used, required tools and MCP servers,
  and an example invocation built from `argument-hint`.
- Status bar items for the active project: context estimate with colour thresholds
  (`claudeExplorer.budgetWarnTokens`), problems, configured MCP servers, and a non-default
  permission mode, model or output style (`claudeExplorer.statusBar`).
- Run in Claude Code (▶) on skills and commands, which starts `claude "/name"` in a new terminal
  after a confirmation, and Assign Keybinding… to bind it in `keybindings.json`.
- Edit Description… on skills, commands and subagents, and Change Setting… for `model`,
  `outputStyle`, `permissions.defaultMode` and `cleanupPeriodDays`.
- Enable/Disable for skills and commands (`skillOverrides`) and for `CLAUDE.md` files and rules
  (`claudeMdExcludes`), and Set Visibility… for the `name-only` and `user-invocable-only` states.
- Compare with Overriding Item, and Why Isn't This in Effect? listing every documented reason.
- Clean Up Configuration…: hooks with missing scripts, stale MCP approvals, expired plans, empty
  folders, skill folders without `SKILL.md` and broken symlinks, removed after one confirmation.
- Hook timeline editing: drag a hook to another event or settings file, Edit… to change its event,
  matcher or command or delete it, and a tool-name box that highlights the hooks that would fire.
- Snippets view: tagged prompts and instructions, edited as documents, sent to Claude Code, copied,
  or inserted into `CLAUDE.md`, `CLAUDE.local.md` and rules; JSON import and export.
- Prompt-driven setup: Set Up with Claude Code…, Harden Security with Claude Code…, Draft a Skill
  with Claude Code… and Personalise Claude Code…, each copied or sent to a new session. Copy
  Prompt… can also send its prompt with the ▶ button.
- A broken `@import` in a `CLAUDE.md` is reported as a problem.
- Guides are much fuller: a summary, when not to use a surface, getting-started steps, an example
  file, commands, settings, pitfalls, troubleshooting, and checked links to downloads, catalogs and
  documentation, for all 16 surfaces.
- Setup Prompt… replaces Copy Setup Prompt: each guide offers two to four prompts, and the extension
  asks for their blanks before copying the prompt or sending it to Claude Code.
- All prompts share one structure (goal, inspect first, requirements, constraints, verify, deliver),
  and rows gained prompts to add skill supporting files, trim an MCP server's tools, audit a plugin
  and give a subagent persistent memory.
- Switchable items show their state in the icon colour: faint when on, solid when off
  (`claudeExplorer.toggle.enabled`, `claudeExplorer.toggle.disabled`). A disabled plugin or MCP server
  no longer shows a warning icon for being disabled; the reason stays in the tooltip.
- An eye icon on the System, User and Workspace headings hides or shows their empty rows (greyed
  placeholders, projects without configuration, the "no policy" row), remembered per heading, with a
  count of what is hidden. `claudeExplorer.showUnusedSurfaces` is now the default for it.
- The right-click menu on tree rows groups its actions into Copy, Edit, Diagnose and Ask Claude Code
  submenus, with Run, Open, Reveal, Show in Overview and Move to Trash at the top level.

### Fixed

- A credential assigned inside a permission rule, such as `Bash(PGPASSWORD=… psql:*)`, was shown
  unmasked in effective settings; the redaction check now also catches `password=`, `secret=` and
  `token=` assignments.
- What is this for? and the setup prompt did nothing when opened from the right-click menu of a
  greyed "none" row.
- Guides linked to a removed slash-commands page and named an `enableWorkflows` setting that does not
  exist.
- `npm run audit` treated the value of `--kind`, `--guide` and `--report` as a folder to scan.

- Descriptions written as a plain YAML value wrapped onto indented lines were read as empty, so
  such skills showed their first body line instead.
- The guide actions on greyed placeholder rows never appeared, because their menu condition
  matched the whole context value exactly.
