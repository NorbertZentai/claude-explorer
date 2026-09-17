import * as vscode from 'vscode';
import { AssetTokens } from '../analysis/contextBudget';
import { Dependencies } from '../analysis/dependencies';
import { Account } from '../discovery/account';
import { ReportTarget } from '../analysis/report';
import { Asset, AssetKind, Scope, ScopeKind } from '../discovery/types';
import { CREATABLE_KINDS } from '../edit/templates';
import { INVOCATION } from '../util/shell';
import { isEditingAllowed, KIND_ICONS, Tone, toneIcon, toneUri } from './style';

export type Node = GroupNode | AssetNode | MessageNode | AccountNode;

/** Derived facts a row's tooltip shows; computed once per scan by the provider. */
export interface AssetInsight {
  tokens?: AssetTokens;
  dependencies?: Dependencies;
}


/** Kinds that are one file or folder of their own, and so can be copied, renamed, deleted. */
const FILE_KINDS = new Set<AssetKind>(['skill', 'command', 'agent', 'rule', 'outputStyle', 'workflow', 'theme']);
/** Kinds "Why Isn't This Loaded?" knows reasons for. */
const WHY_KINDS = new Set<AssetKind>(['skill', 'command', 'agent', 'rule', 'memory', 'hook', 'mcp']);
/** Kinds the Overview page has a row for. */
const DASHBOARD_KINDS = new Set<AssetKind>(['skill', 'command', 'agent', 'rule', 'memory', 'setting', 'hook']);

/**
 * Every flag `contextFlags` can produce. The menu `when` clauses in package.json match this
 * vocabulary with word-boundary regexes, so a rename here silently empties a menu; the
 * contributes test compares the two lists.
 */
export const ASSET_FLAGS = [
  'placeholder',
  'openable',
  'invocable',
  'documented',
  'togglable',
  'disabled',
  'enabled',
  'skillVisibility',
  'creatable',
  'fileBacked',
  'editable',
  'skill',
  'mcpServer',
  'permissions',
  'dashboardable',
  'overridden',
  'runnable',
  'mentionable',
  'describable',
  'settingEditable',
  'diagnosable',
] as const;

/**
 * The flags a row's `contextValue` carries, as a list.
 *
 * Pure and exported because the menu `when` clauses depend on it: two of them match on
 * ADJACENCY (`/\btogglable enabled\b/`, `/\btogglable disabled\b/`) and one on the token
 * standing alone (`/(^| )skill( |$)/`), so the order of these pushes is load-bearing.
 */
export function contextFlags(asset: Asset, editing: boolean): string[] {
  const flags = [asset.placeholder ? 'placeholder' : 'openable'];
  if (asset.invocation) {
    flags.push('invocable');
  }
  if (asset.docs) {
    flags.push('documented');
  }
  if (asset.toggle && editing) {
    flags.push('togglable', asset.enabled === false ? 'disabled' : 'enabled');
    if (asset.toggle.target === 'skill') {
      flags.push('skillVisibility');
    }
  }
  const ownScope = asset.scope.kind === 'user' || asset.scope.kind === 'workspace';
  if (asset.placeholder && editing && ownScope && CREATABLE_KINDS.has(asset.kind)) {
    flags.push('creatable');
  }
  if (!asset.placeholder) {
    // Only your own files: plugin content is managed by the plugin, system by an admin.
    if (FILE_KINDS.has(asset.kind) && (asset.scope.kind === 'user' || asset.scope.kind === 'workspace')) {
      flags.push('fileBacked');
      if (editing) {
        flags.push('editable');
      }
    }
    if (asset.kind === 'skill') {
      flags.push('skill');
    }
    // Stale approvals point at settings.local.json and have no definition to read.
    if (asset.kind === 'mcp' && asset.sourcePath.endsWith('.mcp.json')) {
      flags.push('mcpServer');
    }
    if (asset.kind === 'setting' && asset.name === 'permissions' && editing) {
      flags.push('permissions');
    }
    if (asset.overriddenBy || asset.problem || DASHBOARD_KINDS.has(asset.kind)) {
      flags.push('dashboardable');
    }
    if (asset.overriddenBy) {
      flags.push('overridden');
    }
    if (asset.invocation && INVOCATION.test(asset.invocation) && (asset.kind === 'skill' || asset.kind === 'command')) {
      flags.push('runnable');
    }
    // Subagents have no slash command, so all a session row can offer them is a mention.
    if (asset.kind === 'agent') {
      flags.push('mentionable');
    }
    if (editing && (asset.kind === 'skill' || asset.kind === 'command' || asset.kind === 'agent') && (asset.scope.kind === 'user' || asset.scope.kind === 'workspace')) {
      flags.push('describable');
    }
    if (editing && asset.kind === 'setting' && ['model', 'outputStyle', 'permissions'].includes(asset.name)) {
      flags.push('settingEditable');
    }
    if (WHY_KINDS.has(asset.kind)) {
      flags.push('diagnosable');
    }
  }
  return flags;
}

export class GroupNode extends vscode.TreeItem {
  readonly type = 'group' as const;
  /** Set on a scope group so the remove-folder command knows what to detach. */
  scopeRoot?: string;
  /** Set on a type group ("Skills", "Hooks") so it can open that surface's guide. */
  assetKind?: AssetKind;
  /** Existing directories a type group's assets live in, for "Open Folder". */
  folders?: string[];
  /** What "Export Report" covers when run on this group. */
  reportTarget?: ReportTarget;
  /** Set on a System, User or Workspace heading: whose empty rows its eye icon hides. */
  emptiesScope?: ScopeKind;
  /** Where "+" puts a new item: set when the group belongs to one user or project scope. */
  createTarget?: { scope: Scope; base: string };

  constructor(
    label: string,
    readonly children: Node[],
    icon: string,
    /** 0 = a root group. Only roots start expanded, so each click reveals one more
     *  level rather than dumping the whole tree at once. */
    depth: number,
    description?: string,
    /** Tints the icon and, for a heading, the label text. */
    tone: Tone = { type: 'plain' },
  ) {
    super(
      label,
      children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : depth === 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.iconPath = toneIcon(icon, tone);
    this.description = description ?? `${countAssets(children)}`;
    this.contextValue = 'group';
    this.resourceUri = toneUri(tone);
    if (this.resourceUri) {
      // Without a tooltip VS Code would hover the decoration URI's path.
      this.tooltip = label;
    }
  }
}

export class AssetNode extends vscode.TreeItem {
  readonly type = 'asset' as const;

  constructor(readonly asset: Asset, showScope: boolean, insight: AssetInsight = {}) {
    super(asset.name, vscode.TreeItemCollapsibleState.None);

    const badge = showScope ? `[${asset.scope.label}] ` : '';
    const shadowed = asset.overriddenBy?.everywhere ? 'overridden · ' : '';
    const off =
      asset.skillOverride && asset.skillOverride !== 'on'
        ? `${asset.skillOverride} · `
        : asset.toggle?.target === 'claudeMd' && asset.enabled === false
          ? 'excluded · '
          : '';
    this.description = `${badge}${shadowed}${off}${asset.description ?? ''}`.trim();
    this.tooltip = buildTooltip(asset, insight);

    // Rows stay uncoloured; only the ones that need attention are tinted.
    let tone: Tone;
    let icon = KIND_ICONS[asset.kind];
    if (asset.placeholder) {
      // Deliberately dim and non-actionable-looking: it is a signpost, not content.
      tone = { type: 'muted' };
      icon = 'circle-outline';
    } else if (asset.toggle && asset.enabled === false) {
      // Switched off: the kind icon drawn solid. For a plugin or MCP server "not enabled" is
      // the problem text itself, so the state wins over the warning icon; the tooltip keeps it.
      tone = { type: 'toggleOff' };
    } else if (asset.problem) {
      tone = { type: 'problem' };
      icon = 'warning';
    } else if (asset.enabled === false) {
      tone = { type: 'muted' };
    } else if (asset.overriddenBy?.everywhere) {
      // Not broken, just never in effect: dim it, and say why in the tooltip.
      tone = { type: 'muted' };
      icon = 'debug-step-over';
    } else if (asset.toggle) {
      // Switched on: the kind icon drawn faint, so the off rows stand out.
      tone = { type: 'toggleOn' };
    } else {
      tone = { type: 'plain' };
    }
    this.iconPath = toneIcon(icon, tone);
    this.resourceUri = toneUri(tone);

    this.contextValue = contextFlags(asset, isEditingAllowed()).join(' ');

    this.command = asset.placeholder
      ? {
          command: 'claudeExplorer.showGuide',
          title: 'What is this?',
          arguments: [asset.kind],
        }
      : {
          command: 'claudeExplorer.openItem',
          title: 'Open Source File',
          arguments: [this],
        };
  }
}

export class MessageNode extends vscode.TreeItem {
  readonly type = 'message' as const;

  constructor(label: string, icon = 'info') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'message';
  }
}

/** Who is signed in. Rendered first, and never blocking -- signed out is fine. */
export class AccountNode extends vscode.TreeItem {
  readonly type = 'account' as const;

  constructor(readonly account: Account) {
    super(account.signedIn ? account.label : 'Not signed in to Claude Code');
    this.iconPath = new vscode.ThemeIcon(
      account.signedIn ? 'account' : 'debug-disconnect',
      account.signedIn ? undefined : new vscode.ThemeColor('disabledForeground'),
    );
    this.description = account.signedIn
      ? (account.organization ?? 'signed in')
      : 'browsing local files only';

    const md = new vscode.MarkdownString();
    if (account.signedIn) {
      md.appendMarkdown(`Signed in to Claude Code as **${escape(account.label)}**\n\n`);
      if (account.organization) {
        md.appendMarkdown(`- **Organization:** ${escape(account.organization)}\n`);
      }
      if (account.role) {
        md.appendMarkdown(`- **Role:** ${escape(account.role)}\n`);
      }
    } else {
      md.appendMarkdown(
        'No Claude Code account is signed in.\n\nThis does not affect anything here: ' +
          'the extension reads configuration files from disk and never calls Claude.\n',
      );
    }
    this.tooltip = md;
    this.contextValue = 'account';
  }
}

/** Absolute date plus a relative hint -- "3 days ago" answers the question faster. */
export function formatModified(epochMs: number): string {
  const when = new Date(epochMs);
  const stamp = when.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const days = Math.floor((Date.now() - epochMs) / 86_400_000);
  if (days <= 0) {
    return `${stamp} (today)`;
  }
  if (days === 1) {
    return `${stamp} (yesterday)`;
  }
  return `${stamp} (${days} days ago)`;
}

function buildTooltip(asset: Asset, insight: AssetInsight): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  md.isTrusted = false;
  md.appendMarkdown(`**${escape(asset.name)}** · _${asset.scope.label}_\n\n`);

  if (asset.description) {
    md.appendMarkdown(`${escape(asset.description)}\n\n`);
  }
  const deps = insight.dependencies;
  if (deps?.example) {
    md.appendMarkdown(`Try it:\n\n`);
    md.appendCodeblock(deps.example, 'text');
    if (deps.whenToUse) {
      md.appendMarkdown(`\n_When to use:_ ${escape(deps.whenToUse)}\n\n`);
    }
  } else if (asset.invocation) {
    md.appendMarkdown(`Invoke: \`${asset.invocation}\`\n\n`);
  }
  const t = insight.tokens;
  if (t) {
    const startup = t.startup > 0 ? `≈ ${formatTokens(t.startup)} tokens at startup` : 'nothing at startup';
    const whole = asset.kind === 'memory' || (asset.kind === 'rule' && t.startup === t.full) ? '' : ` · whole file ≈ ${formatTokens(t.full)} when used`;
    md.appendMarkdown(`$(pulse) ${startup}${whole} _(estimate)_\n\n`);
  }
  if (asset.skillOverride && asset.skillOverride !== 'on') {
    md.appendMarkdown(`$(eye-closed) skillOverrides: \`${asset.skillOverride}\`\n\n`);
  }
  if (deps) {
    if (deps.tools.length > 0) {
      md.appendMarkdown(`- **Needs tools:** ${escape(deps.tools.join(', '))}\n`);
    }
    if (deps.mcpServers.length > 0) {
      md.appendMarkdown(`- **MCP servers:** ${escape(deps.mcpServers.join(', '))}\n`);
    }
    if (deps.skills.length > 0) {
      md.appendMarkdown(`- **Preloads skills:** ${escape(deps.skills.join(', '))}\n`);
    }
    if (deps.agent) {
      md.appendMarkdown(`- **Runs in subagent:** ${escape(deps.agent)}\n`);
    }
  }
  if (asset.enabled !== undefined) {
    md.appendMarkdown(`State: ${asset.enabled ? 'enabled' : 'not enabled'}\n\n`);
  }
  for (const [key, value] of Object.entries(asset.detail ?? {})) {
    md.appendMarkdown(`- **${escape(key)}:** ${escape(value)}\n`);
  }
  if (asset.modified !== undefined) {
    md.appendMarkdown(`- **Last modified:** ${escape(formatModified(asset.modified))}\n`);
  }
  if (asset.overriddenBy) {
    const o = asset.overriddenBy;
    md.appendMarkdown(
      `\n$(debug-step-over) Overridden by **${escape(o.name)}** in _${escape(o.scopeLabel)}_. ${escape(o.reason)}\n`,
    );
  }
  if (asset.problem) {
    md.appendMarkdown(`\n$(warning) ${escape(asset.problem)}\n`);
  }
  if (deps && deps.missingMcpServers.length > 0) {
    md.appendMarkdown(
      `\n$(info) No .mcp.json here or in a plugin defines ${escape(deps.missingMcpServers.join(', '))}. Fine if it is a user-level server.\n`,
    );
  }
  md.appendMarkdown(`\n\`${escape(asset.sourcePath)}\``);
  return md;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** Tooltips render markdown, and descriptions routinely contain backticks and asterisks. */
function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, (ch) => `\\${ch}`);
}

export function countAssets(nodes: readonly Node[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node instanceof AssetNode) {
      total += 1;
    } else if (node instanceof GroupNode) {
      total += countAssets(node.children);
    }
  }
  return total;
}
