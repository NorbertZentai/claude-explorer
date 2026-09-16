import * as vscode from 'vscode';
import { Account } from '../discovery/account';
import { Asset, AssetKind } from '../discovery/types';

const ICONS: Record<AssetKind, string> = {
  policy: 'law',
  setting: 'settings-gear',
  skill: 'lightbulb',
  command: 'terminal',
  agent: 'person',
  rule: 'checklist',
  outputStyle: 'paintcan',
  theme: 'color-mode',
  workflow: 'run-all',
  hook: 'plug',
  mcp: 'server-process',
  lsp: 'symbol-namespace',
  plugin: 'extensions',
  keybinding: 'keyboard',
  plan: 'notebook',
  memory: 'book',
};

export type Node = GroupNode | AssetNode | MessageNode | AccountNode;

export class GroupNode extends vscode.TreeItem {
  readonly type = 'group' as const;
  /** Set on a scope group so the remove-folder command knows what to detach. */
  scopeRoot?: string;
  /** Set on a type group ("Skills", "Hooks") so it can open that surface's guide. */
  assetKind?: AssetKind;

  constructor(
    label: string,
    readonly children: Node[],
    icon: string,
    /** 0 = a root group. Only roots start expanded, so each click reveals one more
     *  level rather than dumping the whole tree at once. */
    depth: number,
    description?: string,
  ) {
    super(
      label,
      children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : depth === 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = description ?? `${countAssets(children)}`;
    this.contextValue = 'group';
  }
}

export class AssetNode extends vscode.TreeItem {
  readonly type = 'asset' as const;

  constructor(readonly asset: Asset, showScope: boolean) {
    super(asset.name, vscode.TreeItemCollapsibleState.None);

    const badge = showScope ? `[${asset.scope.label}] ` : '';
    this.description = `${badge}${asset.description ?? ''}`.trim();
    this.tooltip = buildTooltip(asset);
    this.resourceUri = vscode.Uri.file(asset.sourcePath);

    if (asset.placeholder) {
      // Deliberately dim and non-actionable-looking: it is a signpost, not content.
      this.iconPath = new vscode.ThemeIcon(
        'circle-outline',
        new vscode.ThemeColor('disabledForeground'),
      );
    } else if (asset.problem) {
      this.iconPath = new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('list.warningForeground'),
      );
    } else if (asset.enabled === false) {
      this.iconPath = new vscode.ThemeIcon(
        ICONS[asset.kind],
        new vscode.ThemeColor('disabledForeground'),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon(ICONS[asset.kind]);
    }

    const flags = [asset.placeholder ? 'placeholder' : 'openable'];
    if (asset.invocation) {
      flags.push('invocable');
    }
    if (asset.docs) {
      flags.push('documented');
    }
    this.contextValue = flags.join(' ');

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

function buildTooltip(asset: Asset): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  md.isTrusted = false;
  md.appendMarkdown(`**${escape(asset.name)}** · _${asset.scope.label}_\n\n`);

  if (asset.description) {
    md.appendMarkdown(`${escape(asset.description)}\n\n`);
  }
  if (asset.invocation) {
    md.appendMarkdown(`Invoke: \`${asset.invocation}\`\n\n`);
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
  if (asset.problem) {
    md.appendMarkdown(`\n$(warning) ${escape(asset.problem)}\n`);
  }
  md.appendMarkdown(`\n\`${escape(asset.sourcePath)}\``);
  return md;
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
