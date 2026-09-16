# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] — 2026-09-16

First release prepared for public use. The scoping rule changed in a way that will be
visible immediately, hence the major version.

### Changed

- **A scope is the folder you opened, and nothing else.** Previously the extension walked
  up to the outermost enclosing `.claude/` and then listed every sibling that looked like a
  project — opening one repo inside a monorepo showed all of them. Extra folders are now
  added explicitly with the **+** button and remembered per workspace.
- Configuration inherited from parent folders is reported as a note instead of inventing
  scopes for it.
- Removed the `Tools` surface, which scanned `~/.claude/tools/*.py` — a personal
  convention, not a Claude Code concept.

### Fixed

- A malformed configuration file could throw during discovery and leave the tree
  **permanently empty with no error shown**. Failures now render as a row and the previous
  result is kept.
- A UTF-8 BOM — which PowerShell redirection and Notepad write by default — made valid
  `settings.json` report as invalid, silently emptied the plugin list, and showed
  "not signed in" while signed in.
- `CLAUDE_CONFIG_DIR` was ignored, so anyone relocating `~/.claude` saw an empty User scope.
- `enableAllProjectMcpServers` and `disabledMcpjsonServers` were not considered, so every
  project MCP server was permanently flagged as unapproved.
- Hook commands written with `~` reported "script not found" for scripts that exist.
- Skills with a description in the body rather than the frontmatter were wrongly flagged.
- Auto-memory rows named after hyphenated projects were truncated (`claude-explorer` showed
  as "explorer").
- Paths are compared case-insensitively only on Windows; on Linux and macOS two directories
  differing only in case are no longer merged.
- The last-modified date is now actually rendered in tooltips. It was computed but never
  displayed.
- Malformed JSON of the wrong *shape* (an object where an array belongs) is skipped instead
  of throwing.

## [2.x] — 2026-09-16

Internal iterations: the surface catalogue, per-surface guides, Plans as a first-class
surface, the system/policy scope, placeholders for unused surfaces, and non-destructive
refresh with preserved expansion state.
