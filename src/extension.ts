import * as vscode from 'vscode';
import { effectiveSettings } from './analysis/effectiveSettings';
import { evaluate } from './analysis/permissionMatch';
import { securityReport } from './analysis/security';
import { hasClaudeConfig, userClaudeDir } from './discovery/scopes';
import { AssetKind } from './discovery/types';
import { GUIDES, renderGuide } from './guides';
import { registerCreateActions } from './commands/createActions';
import { registerItemActions } from './commands/itemActions';
import { registerRunActions } from './commands/runActions';
import { registerCleanupActions } from './commands/cleanupActions';
import { registerPromptActions } from './commands/promptActions';
import { confirm } from './commands/ui';
import { DashboardPanel } from './dashboard/panel';
import { setEnabled } from './edit/toggle';
import { AssetNode, GroupNode } from './tree/nodes';
import { ClaudeTreeProvider, Grouping } from './tree/provider';
import { ToneDecorationProvider } from './tree/style';
import { registerStatusBar } from './statusBar';
import { registerSnippets } from './snippets/view';

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('claudeExplorer');

  // Per-opened-folder memory, held in VS Code's own storage so nothing is ever written
  // into the folder being browsed -- some of them are read-only clones.
  const store = {
    get<T>(key: string, fallback: T): T {
      return context.workspaceState.get<T>(key) ?? fallback;
    },
    update(key: string, value: unknown): void {
      void context.workspaceState.update(key, value);
    },
  };

  const provider = new ClaudeTreeProvider(store, config.get<Grouping>('defaultGrouping', 'scope'));
  const initial = provider.getGrouping();
  const view = vscode.window.createTreeView('claudeExplorer.tree', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);

  // Tints group headings and flagged rows; see tree/style.ts.
  const decorations = new ToneDecorationProvider();
  context.subscriptions.push(decorations, vscode.window.registerFileDecorationProvider(decorations));

  // Remember what is open so a rescan can put it back exactly as it was.
  context.subscriptions.push(
    view.onDidExpandElement((e) => provider.setExpanded(e.element.id, true)),
    view.onDidCollapseElement((e) => provider.setExpanded(e.element.id, false)),
    // A subtle title-bar note beats emptying the tree: the old data stays readable
    // and usable for the ~100 ms the rescan takes.
    provider.onDidChangeBusy((busy) => {
      view.description = busy ? 'refreshing…' : undefined;
    }),
  );

  void vscode.commands.executeCommand('setContext', 'claudeExplorer.grouping', initial);
  void vscode.commands.executeCommand(
    'setContext',
    'claudeExplorer.filtered',
    provider.getFilter() !== '',
  );
  if (provider.getFilter()) {
    view.title = `Configuration — "${provider.getFilter()}"`;
  }

  const setGrouping = (grouping: Grouping): void => provider.setGrouping(grouping);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeExplorer.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('claudeExplorer.filter', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter Claude configuration',
        placeHolder: 'name, description, scope or type',
        value: provider.getFilter(),
      });
      if (value !== undefined) {
        provider.setFilter(value);
        view.title = value.trim() ? `Configuration — "${value.trim()}"` : 'Configuration';
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.clearFilter', () => {
      provider.setFilter('');
      view.title = 'Configuration';
    }),

    vscode.commands.registerCommand('claudeExplorer.groupByType', () => setGrouping('type')),
    vscode.commands.registerCommand('claudeExplorer.hideEmptyItems', (node?: GroupNode) => {
      if (node?.emptiesScope) {
        provider.setEmptiesHidden(node.emptiesScope, true);
      }
    }),
    vscode.commands.registerCommand('claudeExplorer.showEmptyItems', (node?: GroupNode) => {
      if (node?.emptiesScope) {
        provider.setEmptiesHidden(node.emptiesScope, false);
      }
    }),
    vscode.commands.registerCommand('claudeExplorer.groupByScope', () => setGrouping('scope')),

    vscode.commands.registerCommand('claudeExplorer.openItem', async (node?: AssetNode) => {
      if (!(node instanceof AssetNode)) {
        return;
      }
      const target = node.asset.sourcePath;
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(target));
        if (stat.type === vscode.FileType.Directory) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
          return;
        }
      } catch {
        void vscode.window.showWarningMessage(`Cannot open ${target} - it no longer exists.`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      if (node.asset.line !== undefined) {
        const position = new vscode.Position(node.asset.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.revealInExplorer', (node?: AssetNode) => {
      if (node instanceof AssetNode) {
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.asset.sourcePath));
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.copyPath', async (node?: AssetNode) => {
      if (node instanceof AssetNode) {
        await vscode.env.clipboard.writeText(node.asset.sourcePath);
        void vscode.window.setStatusBarMessage('Path copied', 2000);
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.copyInvocation', async (node?: AssetNode) => {
      if (node instanceof AssetNode && node.asset.invocation) {
        await vscode.env.clipboard.writeText(node.asset.invocation);
        void vscode.window.setStatusBarMessage(`Copied ${node.asset.invocation}`, 2000);
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.addWorkspaceFolder', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Attach folder',
        title: 'Attach a project folder to Explorer for Claude Code',
      });
      const folder = picked?.[0]?.fsPath;
      if (!folder) {
        return;
      }
      if (!hasClaudeConfig(folder)) {
        const go = await vscode.window.showWarningMessage(
          `${folder} has no .claude directory or .mcp.json. Attach it anyway?`,
          'Attach',
          'Cancel',
        );
        if (go !== 'Attach') {
          return;
        }
      }
      if (!provider.attachFolder(folder)) {
        void vscode.window.showInformationMessage('That folder is already attached.');
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.removeWorkspaceFolder', (node?: GroupNode) => {
      if (node?.scopeRoot) {
        provider.detachFolder(node.scopeRoot);
      }
    }),

    vscode.commands.registerCommand('claudeExplorer.enableItem', (node?: AssetNode) => toggleItem(provider, node, true)),
    vscode.commands.registerCommand('claudeExplorer.disableItem', (node?: AssetNode) => toggleItem(provider, node, false)),

    vscode.commands.registerCommand('claudeExplorer.openWalkthrough', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#gettingStarted`,
        false,
      ),
    ),

    vscode.commands.registerCommand('claudeExplorer.openDashboard', () => DashboardPanel.show(context, provider)),
    vscode.commands.registerCommand('claudeExplorer.showEffectiveSettings', () =>
      DashboardPanel.show(context, provider, { section: 'settings' }),
    ),
    vscode.commands.registerCommand('claudeExplorer.showHookTimeline', () =>
      DashboardPanel.show(context, provider, { section: 'hooks' }),
    ),
    vscode.commands.registerCommand('claudeExplorer.showContextBudget', () =>
      DashboardPanel.show(context, provider, { section: 'budget' }),
    ),
    vscode.commands.registerCommand('claudeExplorer.showSecurity', () =>
      DashboardPanel.show(context, provider, { section: 'security' }),
    ),
    vscode.commands.registerCommand('claudeExplorer.showRecentChanges', () =>
      DashboardPanel.show(context, provider, { section: 'recent' }),
    ),
    vscode.commands.registerCommand('claudeExplorer.testPermission', () => testPermission(provider)),

    vscode.commands.registerCommand('claudeExplorer.showProblems', async () => {
      const problems = provider.problems();
      if (problems.length === 0) {
        void vscode.window.showInformationMessage('No problems found in your Claude configuration.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        problems.map((p) => ({
          label: `$(warning) ${p.name}`,
          description: `[${p.scope.label}] ${p.kind}`,
          detail: p.problem,
          asset: p,
        })),
        { title: `${problems.length} problem(s)`, matchOnDetail: true },
      );
      if (picked) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.asset.sourcePath));
        await vscode.window.showTextDocument(doc);
      }
    }),
  );

  // Guides are served as read-only virtual documents so they render in the normal
  // markdown preview -- no webview to theme, and the prompt stays selectable.
  const GUIDE_SCHEME = 'claude-explorer';
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GUIDE_SCHEME, {
      provideTextDocumentContent(uri) {
        const kind = uri.path.replace(/^\//, '').replace(/\.md$/, '') as AssetKind;
        return GUIDES[kind] ? renderGuide(kind) : `# Unknown surface

${uri.path}`;
      },
    }),

    vscode.commands.registerCommand(
      'claudeExplorer.showGuide',
      async (target?: AssetKind | GroupNode | AssetNode) => {
        const kind =
          typeof target === 'string'
            ? target
            : target instanceof GroupNode
              ? target.assetKind
              : target instanceof AssetNode
                ? target.asset.kind
                : undefined;
        if (!kind || !GUIDES[kind]) {
          return;
        }
        const uri = vscode.Uri.parse(`${GUIDE_SCHEME}:/${kind}.md`);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
        try {
          // Preview is much nicer to read; fall back to the source if the command is
          // not available (some VS Code forks ship without the markdown preview).
          await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch {
          await vscode.window.showTextDocument(doc, { preview: true });
        }
      },
    ),
  );

  registerItemActions(context, provider);
  registerCreateActions(context, provider);
  registerRunActions(context, provider);
  registerCleanupActions(context, provider);
  registerPromptActions(context, provider);
  registerWatchers(context, provider);
  registerStatusBar(context, provider);
  registerSnippets(context, provider);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeExplorer.colorful') || e.affectsConfiguration('claudeExplorer.allowEditing')) {
        // Nothing on disk changed, so a rescan would find the same fingerprint and skip
        // the rebuild; icons are baked into the rows and need one.
        decorations.refresh();
        provider.restyle();
      }
      if (e.affectsConfiguration('claudeExplorer.showUnusedSurfaces')) {
        // The setting is the default for every heading's eye toggle: apply it everywhere.
        provider.resetEmptiesHidden();
      }
      if (e.affectsConfiguration('claudeExplorer')) {
        provider.refresh();
      }
    }),
  );

  // Refresh on first run, as asked -- the view is populated before it is opened.
  provider.refresh();
}

/** Ask for a tool call and say which permission rule decides it, for one project. */
async function testPermission(provider: ClaudeTreeProvider): Promise<void> {
  const projects = provider.getCollection().scopes.filter((s) => s.kind === 'workspace');
  let root: string | undefined = projects.find((p) => p.primary)?.root ?? projects[0]?.root;
  if (projects.length > 1) {
    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.label, description: p.root, root: p.root })),
      { title: 'Test permissions for which project?' },
    );
    if (!picked) {
      return;
    }
    root = picked.root;
  }
  const call = await vscode.window.showInputBox({
    title: 'Test a tool call',
    prompt: 'Which permission rule decides this call? Checked deny → ask → allow; an approximation of Claude Code\'s matcher.',
    placeHolder: 'Bash(npm test)   Read(src/index.ts)   WebFetch(https://example.com)   mcp__github__create_issue',
  });
  if (!call?.trim()) {
    return;
  }
  const rules = securityReport(provider.getCollection().assets, effectiveSettings(root), root).rules;
  const result = evaluate(call.trim(), rules, { cwd: root ?? process.cwd(), userClaudeDir: userClaudeDir() });
  const decided = result.rules[0];
  const label = { deny: 'Denied', ask: 'Asks first', allow: 'Allowed', none: 'No rule matches' }[result.decision];
  const answer = await vscode.window.showInformationMessage(`${label}: ${result.explanation}`, ...(decided ? ['Open Rule'] : []));
  if (answer === 'Open Rule' && decided) {
    const line = decided.line ?? 0;
    await vscode.window.showTextDocument(vscode.Uri.file(decided.sourcePath), { selection: new vscode.Range(line, 0, line, 0) });
  }
}

/** Confirm, flip the documented switch, and rescan so the row reflects the file. */
async function toggleItem(provider: ClaudeTreeProvider, node: AssetNode | undefined, enable: boolean): Promise<void> {
  const toggle = node?.asset.toggle;
  if (!toggle || !vscode.workspace.getConfiguration('claudeExplorer').get<boolean>('allowEditing', true)) {
    return;
  }
  const what = { plugin: 'plugin', mcp: 'MCP server', skill: node.asset.kind, claudeMd: node.asset.kind === 'rule' ? 'rule' : 'memory file' }[toggle.target];
  const verb = enable ? 'Enable' : 'Disable';
  const how = {
    plugin: `enabledPlugins["${toggle.key}"]`,
    mcp: 'enabledMcpjsonServers / disabledMcpjsonServers',
    skill: `skillOverrides["${toggle.key}"]${enable ? ' (removed)' : ' = "off"'}`,
    claudeMd: `claudeMdExcludes${enable ? ' (this path removed)' : ' (this path added)'}`,
  }[toggle.target];
  const ok = await confirm(
    `${verb} ${what} "${node.asset.name}"?`,
    `This edits ${how} in ${toggle.file}. Claude Code sessions that are already running may need a restart to pick it up.${
      enable && toggle.target === 'claudeMd' ? '\n\nIf another pattern or another settings file excludes it too, it stays excluded.' : ''
    }`,
    verb,
  );
  if (!ok) {
    return;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(vscode.Uri.file(toggle.file), '..'));
    await setEnabled(toggle, enable);
    provider.refresh();
  } catch (err) {
    void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
  }
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on the context.
}

/**
 * Watch narrowly. `~/.claude` also holds transcripts, a 800 KB history.jsonl and a
 * session cache that churn constantly; a recursive watch over the whole directory would
 * rebuild the tree continuously for no reason.
 */
function registerWatchers(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  const config = vscode.workspace.getConfiguration('claudeExplorer');
  if (!config.get<boolean>('autoRefresh', true)) {
    return;
  }
  const delay = config.get<number>('refreshDebounceMs', 300);

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => provider.refresh(), delay);
  };

  const claudeDir = userClaudeDir();
  const patterns: vscode.RelativePattern[] = [
    new vscode.RelativePattern(vscode.Uri.file(claudeDir), '{skills,commands,agents}/**/*.md'),
    new vscode.RelativePattern(vscode.Uri.file(claudeDir), 'settings*.json'),
    new vscode.RelativePattern(vscode.Uri.file(claudeDir), 'plugins/installed_plugins.json'),
    new vscode.RelativePattern(vscode.Uri.file(claudeDir), 'CLAUDE.md'),
  ];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    patterns.push(new vscode.RelativePattern(folder, '**/.claude/**/*.{md,json,sh}'));
    patterns.push(new vscode.RelativePattern(folder, '**/.mcp.json'));
    patterns.push(new vscode.RelativePattern(folder, '**/CLAUDE.md'));
  }

  for (const pattern of patterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(schedule);
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push({
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
      }
    },
  });
}
