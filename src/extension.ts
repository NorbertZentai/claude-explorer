import * as vscode from 'vscode';
import { hasClaudeConfig, userClaudeDir } from './discovery/scopes';
import { AssetKind } from './discovery/types';
import { GUIDES, renderGuide } from './guides';
import { AssetNode, GroupNode } from './tree/nodes';
import { ClaudeTreeProvider, Grouping } from './tree/provider';

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
      async (target?: AssetKind | GroupNode) => {
        const kind =
          typeof target === 'string' ? target : target instanceof GroupNode ? target.assetKind : undefined;
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

    vscode.commands.registerCommand(
      'claudeExplorer.copyGuidePrompt',
      async (target?: AssetKind | GroupNode) => {
        const kind =
          typeof target === 'string' ? target : target instanceof GroupNode ? target.assetKind : undefined;
        const guide = kind ? GUIDES[kind] : undefined;
        if (!guide) {
          return;
        }
        await vscode.env.clipboard.writeText(guide.prompt);
        void vscode.window.setStatusBarMessage(`Copied the ${guide.title} setup prompt`, 3000);
      },
    ),
  );

  registerWatchers(context, provider);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeExplorer')) {
        provider.refresh();
      }
    }),
  );

  // Refresh on first run, as asked -- the view is populated before it is opened.
  provider.refresh();
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
