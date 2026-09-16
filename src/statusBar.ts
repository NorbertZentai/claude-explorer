import * as path from 'path';
import * as vscode from 'vscode';
import { estimateBudget } from './analysis/contextBudget';
import { estimateCost, formatUsd, pickModel } from './analysis/cost';
import { effectiveSettings } from './analysis/effectiveSettings';
import { formatTokens } from './tree/nodes';
import { ClaudeTreeProvider } from './tree/provider';

/**
 * Status bar items for the project the active editor belongs to: the startup context
 * estimate, problems, configured MCP servers, and a non-default permission mode or model.
 * Everything comes from the last scan; nothing here reads more than the Overview does.
 */

type Mode = 'all' | 'budget' | 'off';

const DEFAULT_MODES = new Set(['default', 'manual']);

export function registerStatusBar(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  const budget = vscode.window.createStatusBarItem('claudeExplorer.budget', vscode.StatusBarAlignment.Left, 50);
  budget.name = 'Claude Code context';
  budget.command = 'claudeExplorer.showContextBudget';
  const problems = vscode.window.createStatusBarItem('claudeExplorer.problems', vscode.StatusBarAlignment.Left, 49);
  problems.name = 'Claude Code problems';
  problems.command = 'claudeExplorer.showProblems';
  const mcp = vscode.window.createStatusBarItem('claudeExplorer.mcp', vscode.StatusBarAlignment.Left, 48);
  mcp.name = 'Claude Code MCP servers';
  mcp.command = 'claudeExplorer.openDashboard';
  const mode = vscode.window.createStatusBarItem('claudeExplorer.mode', vscode.StatusBarAlignment.Left, 47);
  mode.name = 'Claude Code session mode';
  mode.command = 'claudeExplorer.showEffectiveSettings';
  const items = [budget, problems, mcp, mode];
  context.subscriptions.push(...items);

  let timer: NodeJS.Timeout | undefined;
  const update = (): void => {
    const config = vscode.workspace.getConfiguration('claudeExplorer');
    const setting = config.get<Mode>('statusBar', 'all');
    if (setting === 'off' || provider.getCollection().scopes.length === 0) {
      items.forEach((i) => i.hide());
      return;
    }
    const collection = provider.getCollection();
    const root = activeProjectRoot(provider);
    const project = collection.scopes.find((s) => s.kind === 'workspace' && s.root === root);

    const report = estimateBudget(collection.assets, root, provider.getMcpMeasurements());
    const settings = effectiveSettings(root);
    const effective = (key: string): string | undefined =>
      settings.entries.find((e) => e.keyPath === key && e.status === 'effective')?.value;
    const picked = pickModel(config.get<string>('costModel', 'auto'), effective('model'));
    const cost = estimateCost(report.totalTokens, picked.model, picked.basis, config.get<number>('inputPricePerMTok', 0));

    const warnAt = Math.max(1, config.get<number>('budgetWarnTokens', 10_000));
    budget.text = `$(hubot) ≈ ${formatTokens(report.totalTokens)}`;
    budget.backgroundColor =
      report.totalTokens >= warnAt * 2
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : report.totalTokens >= warnAt
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**Claude Code startup context** · ${project ? escape(project.label) : 'user only'}\n\n`);
    tip.appendMarkdown(`≈ ${report.totalTokens.toLocaleString('en-US')} tokens before the first prompt _(estimate)_\n\n`);
    tip.appendMarkdown(`≈ ${formatUsd(cost.firstRequest)} first request, ${formatUsd(cost.cachedRequest)} cached, at ${escape(cost.model.label)} list prices\n\n`);
    for (const row of report.rows.slice(0, 3)) {
      tip.appendMarkdown(`- ${escape(row.name.split(/[\\/]/).pop() ?? row.name)}: ${row.tokens.toLocaleString('en-US')}\n`);
    }
    tip.appendMarkdown(`\nWarns above ${warnAt.toLocaleString('en-US')} tokens (\`claudeExplorer.budgetWarnTokens\`). Click for the breakdown.`);
    budget.tooltip = tip;
    budget.show();

    if (setting === 'budget') {
      [problems, mcp, mode].forEach((i) => i.hide());
      return;
    }

    const relevant = collection.assets.filter(
      (a) => !a.placeholder && (a.scope.kind !== 'workspace' || a.scope.root === root),
    );
    const problemCount = relevant.filter((a) => a.problem).length;
    if (problemCount > 0) {
      problems.text = `$(warning) ${problemCount}`;
      problems.tooltip = `${problemCount} Claude Code configuration problem${problemCount === 1 ? '' : 's'} (missing scripts, unapproved MCP servers, broken imports…). Click to list them.`;
      problems.show();
    } else {
      problems.hide();
    }

    const servers = relevant.filter((a) => a.kind === 'mcp' && a.enabled !== false && !a.sourcePath.endsWith('settings.local.json'));
    if (servers.length > 0) {
      mcp.text = `$(plug) ${servers.length}`;
      mcp.tooltip = `${servers.length} MCP server${servers.length === 1 ? '' : 's'} configured and enabled for ${project?.label ?? 'this window'}: ${servers.map((s) => s.name).join(', ')}.\nConfigured, not necessarily running: Claude Code starts them per session.`;
      mcp.show();
    } else {
      mcp.hide();
    }

    const parts: string[] = [];
    const permissionMode = effective('permissions.defaultMode');
    if (permissionMode && !DEFAULT_MODES.has(permissionMode)) {
      parts.push(permissionMode);
    }
    const model = effective('model');
    if (model) {
      parts.push(model);
    }
    const style = effective('outputStyle');
    if (style && style.toLowerCase() !== 'default') {
      parts.push(style);
    }
    if (parts.length > 0) {
      mode.text = `$(settings-gear) ${parts.join(' · ')}`;
      mode.tooltip = `What a new Claude Code session in ${project?.label ?? 'this window'} starts with: ${[
        permissionMode && `permission mode ${permissionMode}`,
        model && `model ${model}`,
        style && `output style ${style}`,
      ]
        .filter(Boolean)
        .join(', ')}. Click for the effective settings.`;
      mode.backgroundColor = permissionMode === 'bypassPermissions' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      mode.show();
    } else {
      mode.hide();
    }
  };
  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(update, 150);
  };

  context.subscriptions.push(
    provider.onDidChangeTreeData(schedule),
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeExplorer')) {
        schedule();
      }
    }),
    { dispose: () => timer && clearTimeout(timer) },
  );
  schedule();
}

/** The project of the active editor, else the primary project, else none (user only). */
export function activeProjectRoot(provider: ClaudeTreeProvider): string | undefined {
  const projects = provider.getCollection().scopes.filter((s) => s.kind === 'workspace');
  const file = vscode.window.activeTextEditor?.document.uri;
  if (file?.scheme === 'file') {
    const containing = projects
      .filter((p) => file.fsPath === p.root || file.fsPath.startsWith(p.root.endsWith(path.sep) ? p.root : `${p.root}${path.sep}`))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (containing) {
      return containing.root;
    }
  }
  return (projects.find((p) => p.primary) ?? projects[0])?.root;
}

function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, (ch) => `\\${ch}`);
}
