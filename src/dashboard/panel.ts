import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { estimateBudget } from '../analysis/contextBudget';
import { estimateCost, pickModel } from '../analysis/cost';
import { effectiveSettings } from '../analysis/effectiveSettings';
import { hookTimeline } from '../analysis/hookTimeline';
import { evaluate } from '../analysis/permissionMatch';
import { Suggestion, suggestOptimizations } from '../analysis/optimizer';
import { recentChanges } from '../analysis/recent';
import { readUsage } from '../analysis/usage';
import { promptsFor } from '../prompts';
import { referenceFor } from '../commands/itemActions';
import { setSkillVisibility } from '../commands/runActions';
import { AssetNode } from '../tree/nodes';
import { securityReport } from '../analysis/security';
import { userClaudeDir } from '../discovery/scopes';
import { PAGE_PROMPTS } from '../prompts';
import { isEditingAllowed } from '../tree/style';
import { editHook, Layer, layerFile, moveHook } from './hookEditor';
import { TimelineEvent } from '../analysis/hookTimeline';
import { ClaudeTreeProvider } from '../tree/provider';
import { renderBody, SectionId } from './render';

/** Where to take the reader: a section, optionally one row in it, in a given project. */
export interface RevealTarget {
  section: SectionId;
  /** Matches a row's `data-key`, by prefix. */
  key?: string;
  /** Project to select first; undefined keeps the current selection. */
  root?: string;
}

/**
 * One dashboard panel at a time. It re-renders whenever the tree rebuilds, so it never
 * shows configuration the sidebar has already moved past.
 */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;

  private selectedRoot: string | undefined;
  private pendingReveal: RevealTarget | undefined;
  /** True once the current page's script has loaded. */
  private loaded = false;
  /** Only paths the current render put on the page may be opened. */
  private openable = new Set<string>();
  /** The rules on the current page, for the permission tester. */
  private permissionRules: ReturnType<typeof securityReport>['rules'] = [];
  /** The timeline on the current page; the page refers to hooks by `<event>-<hook>` index. */
  private timeline: TimelineEvent[] = [];
  private suggestions: Suggestion[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, provider: ClaudeTreeProvider, target?: RevealTarget): void {
    const existing = DashboardPanel.current;
    const panel = existing ?? new DashboardPanel(context, provider);
    DashboardPanel.current = panel;
    if (existing) {
      existing.panel.reveal();
    }
    if (!target) {
      return;
    }
    panel.pendingReveal = target;
    if (target.root !== undefined && target.root !== panel.selectedRoot) {
      // The row belongs to another project: switch the page to it; the reveal follows
      // once the new page reports ready.
      panel.selectedRoot = target.root;
      panel.render();
    } else if (panel.loaded) {
      panel.flushReveal();
    }
  }

  /** Sent once the page's script says it is listening; a message before that is lost. */
  private flushReveal(): void {
    if (this.pendingReveal) {
      const { section, key } = this.pendingReveal;
      void this.panel.webview.postMessage({ type: 'reveal', section, key });
      this.pendingReveal = undefined;
    }
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: ClaudeTreeProvider,
    private readonly panel = vscode.window.createWebviewPanel(
      'claudeExplorer.dashboard',
      'Claude Code Overview',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources', 'dashboard')],
      },
    ),
  ) {
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'claude.svg');
    const primary = provider.getCollection().scopes.find((s) => s.kind === 'workspace' && s.primary);
    this.selectedRoot = primary?.root;

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg)),
      provider.onDidChangeTreeData(() => this.render()),
    );
    this.render();
  }

  private render(): void {
    const collection = this.provider.getCollection();
    const projects = collection.scopes.filter((s) => s.kind === 'workspace');
    if (this.selectedRoot && !projects.some((p) => p.root === this.selectedRoot)) {
      this.selectedRoot = projects[0]?.root;
    }
    const settings = effectiveSettings(this.selectedRoot);
    const budget = estimateBudget(collection.assets, this.selectedRoot, this.provider.getMcpMeasurements());
    const config = vscode.workspace.getConfiguration('claudeExplorer');
    const effectiveModel = settings.entries.find((e) => e.keyPath === 'model' && e.status === 'effective')?.value;
    const picked = pickModel(config.get<string>('costModel', 'auto'), effectiveModel);
    const security = securityReport(collection.assets, settings, this.selectedRoot);
    this.permissionRules = security.rules;
    const model = {
      assets: collection.assets,
      projects,
      selectedRoot: this.selectedRoot,
      budget,
      settings,
      timeline: hookTimeline(collection.assets, this.selectedRoot),
      editable: isEditingAllowed(),
      security,
      cost: estimateCost(budget.totalTokens, picked.model, picked.basis, config.get<number>('inputPricePerMTok', 0)),
      recent: recentChanges(collection.assets, Date.now()),
      suggestions: [] as Suggestion[],
      usage: undefined as { filesRead: number; days: number } | undefined,
      newKeys: this.provider.newAssetKeys(),
    };
    this.timeline = model.timeline;
    const usage = config.get<boolean>('readTranscriptsForUsage', false) ? readUsage(userClaudeDir(), Date.now()) : undefined;
    model.usage = usage && { filesRead: usage.filesRead, days: 90 };
    model.suggestions = suggestOptimizations(budget, collection.assets, usage, Date.now());
    this.suggestions = model.suggestions;
    const body = renderBody(model);
    this.openable = new Set([...body.matchAll(/data-path="([^"]*)"/g)].map((m) => unescapeAttr(m[1])));
    this.loaded = false;
    this.panel.webview.html = this.page(body);
  }

  private page(body: string): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const asset = (name: string): vscode.Uri =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dashboard', name));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('dashboard.css')}">
<title>Claude Code Overview</title>
</head>
<body>
${body}
<script nonce="${nonce}" src="${asset('dashboard.js')}"></script>
</body>
</html>`;
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    const m = msg as { type?: string; path?: string; line?: number; root?: string; text?: string; prompt?: string; key?: string; hook?: string; event?: string; layer?: string };
    if (m.type === 'ready') {
      this.loaded = true;
      this.flushReveal();
    } else if (m.type === 'open' && typeof m.path === 'string' && this.openable.has(m.path)) {
      const line = typeof m.line === 'number' ? m.line : 0;
      try {
        await vscode.window.showTextDocument(vscode.Uri.file(m.path), {
          selection: new vscode.Range(line, 0, line, 0),
          viewColumn: vscode.ViewColumn.Beside,
        });
      } catch {
        // A directory or a file that vanished since the render.
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(m.path));
      }
    } else if (m.type === 'testPermission' && typeof m.text === 'string') {
      const result = evaluate(m.text.slice(0, 2000), this.permissionRules, {
        cwd: this.selectedRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        userClaudeDir: userClaudeDir(),
      });
      // Plain text back; the page sets it with textContent, never as markup.
      void this.panel.webview.postMessage({ type: 'permissionResult', decision: result.decision, text: result.explanation });
    } else if (m.type === 'copyPrompt' && typeof m.prompt === 'string' && Object.hasOwn(PAGE_PROMPTS, m.prompt)) {
      await vscode.env.clipboard.writeText(PAGE_PROMPTS[m.prompt as keyof typeof PAGE_PROMPTS]);
      void vscode.window.setStatusBarMessage('Copied prompt. Paste it into Claude Code.', 4000);
    } else if (m.type === 'editHook' || m.type === 'moveHook') {
      const hook = this.hookAt(m.type === 'editHook' ? m.key : m.hook);
      if (!hook) {
        return;
      }
      try {
        let changed = false;
        if (m.type === 'editHook') {
          changed = await editHook(hook, this.selectedRoot);
        } else if (typeof m.event === 'string' && this.timeline.some((ev) => ev.name === m.event)) {
          changed = await moveHook(hook, m.event, hook.declaration.file);
        } else if (m.layer === 'user' || m.layer === 'project' || m.layer === 'local') {
          const file = layerFile(m.layer as Layer, this.selectedRoot);
          changed = file !== undefined && (await moveHook(hook, hook.declaration.event, file));
        }
        if (changed) {
          this.provider.refresh();
        }
      } catch (err) {
        void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    } else if (m.type === 'applySuggestion') {
      await this.applySuggestion(this.suggestions[Number(m.key)]);
    } else if (m.type === 'selectScope') {
      this.selectedRoot = m.root ? m.root : undefined;
      this.render();
    }
  }

  private async applySuggestion(suggestion: Suggestion | undefined): Promise<void> {
    const asset = suggestion && this.provider.getCollection().assets.find((a) => !a.placeholder && a.sourcePath === suggestion.sourcePath);
    if (!suggestion || !asset) {
      return;
    }
    const action = suggestion.action;
    try {
      if (action.type === 'skillVisibility') {
        await setSkillVisibility(this.provider, new AssetNode(asset, false), action.state);
      } else if (action.type === 'editDescription') {
        await vscode.commands.executeCommand('claudeExplorer.editDescription', new AssetNode(asset, false));
      } else {
        const prompt = promptsFor(asset, { ref: referenceFor(asset) }).find((p) => p.label === action.label);
        if (prompt) {
          await vscode.env.clipboard.writeText(prompt.text);
          void vscode.window.setStatusBarMessage('Copied prompt. Paste it into Claude Code.', 4000);
        }
      }
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  private hookAt(id: unknown): TimelineEvent['hooks'][number] | undefined {
    const match = typeof id === 'string' ? /^(\d+)-(\d+)$/.exec(id) : null;
    return match ? this.timeline[Number(match[1])]?.hooks[Number(match[2])] : undefined;
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function unescapeAttr(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}
