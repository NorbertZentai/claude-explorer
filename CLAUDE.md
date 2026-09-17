# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Explorer for Claude Code**, a VS Code extension (published as `semaxien.explorer-for-claude-code`, targets VS Code ≥1.90 and forks such as Antigravity and Cursor). It shows every Claude Code configuration surface on the machine (skills, commands, subagents, hooks, MCP servers, plugins, settings, memory and more) as a tree, flags problems, and has an Overview webview. It is unofficial, and everything it says about Claude Code behaviour is based on the docs at code.claude.com/docs. Check the docs before changing precedence or merge rules.

## Commands

```bash
npm run compile      # esbuild → dist/extension.js and dist/audit.js (dev, with sourcemaps)
npm run watch        # same, rebuild on change
npm run typecheck    # tsc --noEmit for src AND test (also what `npm run lint` runs; there is no ESLint)
npm test             # esbuild test/**/*.test.ts -> out/test, then node --test
npm run test:watch   # rebuild and re-run on change
npm run audit -- <folder...> [--attach <folder...>] [--kind skill,hook] [--guide <kind>|all] [--lint] [--report <user|system|plugin|folder-suffix>] [--prompts]
npx @vscode/vsce package -o <out>.vsix   # runs vscode:prepublish (production bundle) first
```

- **Tests:** `node:test`, no test dependency. `test/**/*.test.ts` is bundled by `esbuild.test.mjs` into `out/test` and run with `node --test`. A `vscode` stub (`test/stubs/vscode.ts`) is aliased in by esbuild, which is what makes the tree and command layer testable without a VS Code host; it throws on any API it does not stub, so straying into unstubbed ground fails loudly. Fixtures come from `test/helpers/fixture.ts` (a temp `.claude` tree plus `CLAUDE_CONFIG_DIR`); compare paths against `fixture.dir`, never `os.tmpdir()`, because discovery stores `realPath(root)`.
- **`npm run audit`** remains the headless run of discovery and analysis on real folders. It exits non-zero if the redaction check finds anything secret-shaped in rendered output, or if `--guide all` finds a surface without a guide. Both of those assertions now also exist as tests (`test/redactionSweep.test.ts`, `test/guides.test.ts`) so they fail in CI rather than only when someone runs the CLI.
- **`test/contributes.test.ts`** keeps `package.json` and the source honest: every contributed command is registered and vice versa, every menu entry names a real command or submenu, and every `viewItem =~ /\bflag\b/` names a flag `contextFlags()` can actually produce. Add a flag there and to `ASSET_FLAGS` in the same commit.
- **Isolated fixtures:** set `CLAUDE_CONFIG_DIR=<dir>/.claude` to point the user scope at a fixture.
- **Pure modules** can also be exercised directly: bundle a small script with `npx esbuild script.ts --bundle --platform=node --main-fields=module,main` and run it with node.
- **Debug:** the F5 "Run Extension" launch config (`.vscode/launch.json`).
- **Install into Antigravity:** `"/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" --install-extension <vsix> --force`, then Reload Window.

## Architecture

Layering is the main rule: **`src/discovery`, `src/analysis`, `src/edit/*Text.ts`, `src/mcp` and `src/dashboard/render.ts` never import `vscode`.** That is what lets `src/audit.ts` run them in plain Node. `vscode` glue lives in `src/extension.ts`, `src/statusBar.ts`, `src/tree`, `src/commands`, `src/snippets/view.ts`, `src/dashboard/{panel,hookEditor}.ts` and `src/edit/{jsonFile,toggle}.ts`. `src/snippets/store.ts`, `src/util` and `src/prompts.ts` are pure too.

- **Discovery** (`src/discovery/index.ts` → `collect()`) returns a `Collection`: a flat list of `Asset`s (defined in `types.ts`) plus the scopes.
  - Scope kinds, highest precedence first: `system` (managed settings), `user` (`~/.claude` or `CLAUDE_CONFIG_DIR`), `plugin` (from `installed_plugins.json`), `workspace` (one per opened or attached folder; the opened folder is the scope, parents are never walked for scopes).
  - `surfaces.ts` holds the `SURFACES` catalogue: where each kind lives per scope. It drives generic discovery, the greyed placeholder rows, and `surfaceDirs()` for file actions.
  - Bespoke readers handle skills, commands and agents (`markdownAssets.ts` with the hand-written YAML-subset parser in `frontmatter.ts`), settings, hooks, MCP and system.
  - `collect()` finishes with `applyOverrides()` and an mtime pass.
- **Analysis** (`src/analysis`): pure functions over a collection, each scoped to one project because a Claude Code session runs in one project.
  - `overrides.ts`: name shadowing, with rules that differ for skills/commands vs subagents.
  - `contextBudget.ts`: characters ÷ 4 token estimate, plus MCP measurements.
  - `effectiveSettings.ts`: merges managed > project local > project > user local > user; lists concatenate.
  - `hookTimeline.ts`, `skillLint.ts`, `report.ts`.
- **Tree** (`src/tree`):
  - `provider.ts` rebuilds nodes from the collection. A rescan only replaces the tree when `fingerprint()` changes, and ids are content-derived so expansion survives. Anything view-only, such as the colour setting, must call `restyle()`, because `refresh()` alone is skipped by the fingerprint.
  - `nodes.ts` sets `contextValue` as a **space-separated flag list** (`openable`, `editable`, `mcpServer`, `togglable enabled`, `typeGroup kind-hook folders`, `exportable`…). Menu `when` clauses in `package.json` match flags with word-boundary regexes, never `==`.
  - `style.ts`: colours are contributed theme colours (`claudeExplorer.scope.*`). Label colour comes from a `FileDecorationProvider` on the private `claude-explorer-tone:` URI scheme, so real files in the main Explorer are never recoloured. `claude-explorer:` is taken by the guide documents.
- **Commands:** tree-row actions are in `src/commands/itemActions.ts` (read, copy, edit) and `src/commands/createActions.ts` (New…, Set Up Claude Code Here…); top-level ones are in `extension.ts`. Templates for new items live in `src/edit/templates.ts`; per-item prompts in `src/prompts.ts`, built only from display fields. The Overview is `src/dashboard`: `render.ts` builds escaped HTML; `panel.ts` enforces a strict CSP (no inline scripts or styles, so bar widths are set from `data-width` by `resources/dashboard/dashboard.js`), allows opening only paths present in the current render, and waits for the page's `ready` message before posting a `reveal`.
- **Writes:** every write goes through a confirmation and is gated by `claudeExplorer.allowEditing` (`isEditingAllowed()`), checked again inside the command. JSON edits use `jsonc-parser` via `src/edit/jsonText.ts` (minimal edits, strict-JSON refusal) and `applyJsonEdit()` (WorkspaceEdit, so undo works). esbuild needs `mainFields: ['module','main']` because jsonc-parser's UMD build does not bundle.

## Invariants worth keeping

- **Secrets:** `env` values and header values never enter an `Asset` or any rendered string. `src/util/redact.ts` is the only path by which env data or command lines reach the screen (`envVarNames`, `redactCommandLine`, `redactValue`, `redactText`). Raw MCP definitions are read on demand with `src/mcp/definition.ts`, used, and dropped. New rendered output should be added to the audit redaction check.
- **Robustness:** hand-edited JSON of the wrong shape must be skipped, never thrown on; a scan failure renders as a row and keeps the previous tree.
- **Processes and network:** the only process spawn is `src/mcp/probe.ts` (stdio MCP servers, after confirmation, 20 s timeout). Starting Claude Code goes only through `sendToClaude()` in `src/commands/runActions.ts`: a visible VS Code terminal, a first-time confirmation, the prompt quoted with `src/util/shell.ts`, and slash-command arguments from keybindings validated against `INVOCATION`. Transcripts are read only by `src/analysis/usage.ts`, only when `claudeExplorer.readTranscriptsForUsage` is on, and only names and dates are kept. There is no network access, and the README's Privacy section makes promises about all of this. Update it if that changes.
- **Switching things off:** use the documented settings (`enabledPlugins`, `enabledMcpjsonServers`, `skillOverrides`, `claudeMdExcludes`), never renames. `src/discovery/visibility.ts` reads them; the Overview hook editor sends only `<event>-<hook>` indexes, never commands.
- **Docs:** user-facing changes go in `CHANGELOG.md` (Keep a Changelog). The README's Privacy and Settings tables must match `package.json`.
- **Publishing:** `.github/workflows/publish.yml` publishes to the VS Code Marketplace and Open VSX on push to `main`, using `--skip-duplicate`. **Bumping `version` in `package.json` is what triggers a release.** Secrets needed: `VSCE_PAT`, `OVSX_PAT`.
