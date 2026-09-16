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

### Fixed

- Descriptions written as a plain YAML value wrapped onto indented lines were read as empty, so
  such skills showed their first body line instead.
- The guide actions on greyed placeholder rows never appeared, because their menu condition
  matched the whole context value exactly.
