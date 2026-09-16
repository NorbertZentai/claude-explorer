import * as vscode from 'vscode';
import { collect, Collection } from '../discovery';
import { samePath } from '../discovery/scopes';
import { Asset, ASSET_LABELS, ASSET_ORDER, AssetKind, ScopeKind } from '../discovery/types';
import { AccountNode, AssetNode, GroupNode, MessageNode, Node } from './nodes';

export type Grouping = 'scope' | 'type';

/**
 * Everything the view remembers is stored per opened folder, in VS Code's own storage --
 * deliberately NOT in the folder's `.vscode/settings.json`. Writing a settings file into
 * whatever folder happens to be open would dirty it, and some of the folders browsed here
 * are read-only clones. `claudeExplorer.extraProjectPaths` still works for anyone who
 * wants the list in settings; the two are merged.
 */
export interface StateStore {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): void;
}

const KEY_GROUPING = 'claudeExplorer.grouping';
const KEY_FILTER = 'claudeExplorer.filter';
const KEY_ATTACHED = 'claudeExplorer.attachedPaths';

// Highest precedence first: system policy overrides everything below it.
const SCOPE_ORDER: ScopeKind[] = ['system', 'user', 'plugin', 'workspace'];
const SCOPE_HEADINGS: Record<ScopeKind, string> = {
  system: 'System',
  user: 'User',
  plugin: 'Plugins',
  workspace: 'Workspace',
};
const SCOPE_ICONS: Record<ScopeKind, string> = {
  system: 'law',
  user: 'account',
  plugin: 'extensions',
  workspace: 'folder',
};

export class ClaudeTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private collection: Collection = {
    assets: [],
    scopes: [],
    account: { signedIn: false, label: 'Not signed in to Claude Code', sourcePath: '' },
    inherited: [],
  };
  private roots: Node[] = [];
  private grouping: Grouping;
  private filterText: string;

  /** Ids the user has opened. Survives a refresh, which is the whole point. */
  private readonly expandedIds = new Set<string>();
  /** Fingerprint of the last collection, so an unrelated file save is a no-op. */
  private signature = '';
  private busy = false;
  private pending = false;
  /** Set when the last scan threw; rendered as a row rather than swallowed. */
  private error?: string;
  private readonly busyEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeBusy = this.busyEmitter.event;

  constructor(
    private readonly state: StateStore,
    defaultGrouping: Grouping,
  ) {
    this.grouping = state.get<Grouping>(KEY_GROUPING, defaultGrouping);
    this.filterText = state.get<string>(KEY_FILTER, '');
  }

  refresh(): void {
    void this.refreshAsync();
  }

  /**
   * Rescan without ever emptying the view.
   *
   * The previous tree stays on screen for the whole scan, and the fresh result replaces
   * it only if it actually differs -- so saving an unrelated file costs nothing visible.
   * Discovery is ~100 ms of synchronous fs calls; yielding first lets the view paint the
   * busy state instead of freezing mid-frame.
   */
  private async refreshAsync(): Promise<void> {
    if (this.busy) {
      this.pending = true; // coalesce: one more pass after the current one
      return;
    }
    this.busy = true;
    this.busyEmitter.fire(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const config = vscode.workspace.getConfiguration('claudeExplorer');
      const fromSettings = config.get<string[]>('extraProjectPaths', []);
      const next = collect({
        workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
        extraProjectPaths: [...fromSettings, ...this.attachedPaths()],
        showPluginProvided: config.get<boolean>('showPluginProvided', true),
        showPlaceholders: config.get<boolean>('showUnusedSurfaces', true),
      });

      const signature = fingerprint(next);
      if (signature !== this.signature) {
        this.signature = signature;
        this.collection = next;
        this.error = undefined;
        this.rebuild();
      }
    } catch (err) {
      // Without this the exception vanished into a voided promise and the tree stayed
      // empty forever, with nothing on screen to say why. A scan that fails must say so
      // and keep whatever it managed to show last time.
      this.error = err instanceof Error ? err.message : String(err);
      this.signature = '';
      this.rebuild();
    } finally {
      this.busy = false;
      this.busyEmitter.fire(false);
      if (this.pending) {
        this.pending = false;
        void this.refreshAsync();
      }
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  /** Called from the TreeView's expand/collapse events. */
  setExpanded(id: string | undefined, open: boolean): void {
    if (!id) {
      return;
    }
    if (open) {
      this.expandedIds.add(id);
    } else {
      this.expandedIds.delete(id);
    }
  }

  // --- persisted state ---------------------------------------------------------

  attachedPaths(): string[] {
    return this.state.get<string[]>(KEY_ATTACHED, []);
  }

  attachFolder(folder: string): boolean {
    const current = this.attachedPaths();
    if (current.some((p) => samePath(p, folder))) {
      return false;
    }
    this.state.update(KEY_ATTACHED, [...current, folder]);
    this.refresh();
    return true;
  }

  detachFolder(folder: string): void {
    this.state.update(
      KEY_ATTACHED,
      this.attachedPaths().filter((p) => !samePath(p, folder)),
    );
    this.refresh();
  }

  setGrouping(grouping: Grouping): void {
    this.grouping = grouping;
    this.state.update(KEY_GROUPING, grouping);
    void vscode.commands.executeCommand('setContext', 'claudeExplorer.grouping', grouping);
    this.rebuild();
  }

  getGrouping(): Grouping {
    return this.grouping;
  }

  setFilter(text: string): void {
    this.filterText = text.trim().toLowerCase();
    this.state.update(KEY_FILTER, this.filterText);
    void vscode.commands.executeCommand(
      'setContext',
      'claudeExplorer.filtered',
      this.filterText !== '',
    );
    this.rebuild();
  }

  getFilter(): string {
    return this.filterText;
  }

  problems(): Asset[] {
    return this.collection.assets.filter((a) => a.problem !== undefined);
  }

  // --- tree --------------------------------------------------------------------

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      return this.roots;
    }
    return element instanceof GroupNode ? element.children : [];
  }

  private rebuild(): void {
    const visible = this.collection.assets.filter((a) => this.matches(a));
    const groups = this.grouping === 'scope' ? this.byScope(visible) : this.byType(visible);
    // The account row is status, not content: never filtered away, never a group.
    this.roots = [new AccountNode(this.collection.account), ...groups];

    if (this.error) {
      this.roots.push(
        new MessageNode(`Scan failed: ${this.error}`, 'error'),
        new MessageNode('Showing the last successful result. Refresh to retry.', 'info'),
      );
    }

    if (groups.length === 0 && !this.error) {
      this.roots.push(
        new MessageNode(
          this.filterText
            ? `No matches for "${this.filterText}"`
            : this.collection.note ?? 'No Claude configuration found',
          this.filterText ? 'search-stop' : 'info',
        ),
      );
    } else if (this.collection.note) {
      this.roots.push(new MessageNode(this.collection.note));
    }

    // Files outside the open folder that still govern it. Shown as information, not as
    // scopes -- the open folder is the workspace, and that is the whole point.
    if (this.collection.inherited.length > 0 && !this.filterText) {
      const n = this.collection.inherited.length;
      const node = new MessageNode(
        `Also inherits ${n} file${n === 1 ? '' : 's'} from parent folders`,
        'arrow-up',
      );
      node.tooltip = this.collection.inherited.join('\n');
      this.roots.push(node);
    }

    // Stable ids are what let VS Code match old rows to new ones; without them every
    // refresh is a brand-new tree and the user's open sections snap shut.
    assignIds(this.roots, '');
    restoreExpansion(this.roots, this.expandedIds);

    this.emitter.fire(undefined);
  }

  private matches(asset: Asset): boolean {
    if (this.filterText === '') {
      return true;
    }
    const haystack = [asset.name, asset.description ?? '', asset.scope.label, asset.kind]
      .join(' ')
      .toLowerCase();
    return haystack.includes(this.filterText);
  }

  /** User / Plugins / Workspace, each split by asset type. */
  private byScope(assets: readonly Asset[]): Node[] {
    const out: Node[] = [];

    for (const kind of SCOPE_ORDER) {
      const inScope = assets.filter((a) => a.scope.kind === kind);

      // Workspace is always rendered even when empty, because it carries the "attach a
      // folder" action -- an action you cannot reach is not an action. System is always
      // rendered because "checked, nothing set" and "never looked" are different answers.
      if (inScope.length === 0 && kind !== 'workspace' && kind !== 'system') {
        continue;
      }

      if (kind === 'system') {
        const children: Node[] =
          inScope.length > 0
            ? this.typeGroups(inScope, false, 1)
            : [new MessageNode('No administrator or organization policy on this machine', 'check')];
        out.push(new GroupNode(SCOPE_HEADINGS[kind], children, SCOPE_ICONS[kind], 0));
        continue;
      }

      if (kind === 'user') {
        out.push(new GroupNode(SCOPE_HEADINGS[kind], this.typeGroups(inScope, false, 1), SCOPE_ICONS[kind], 0));
        continue;
      }

      // Workspaces are driven by the SCOPE list, not by the assets: a project with no
      // configuration yet must still be listed, otherwise it looks like discovery failed.
      // Plugins keep the asset-driven grouping -- a plugin with nothing in it is noise.
      const children: Node[] =
        kind === 'workspace'
          ? this.workspaceChildren(inScope)
          : this.pluginChildren(inScope);

      if (kind === 'workspace' && children.length === 0) {
        children.push(
          new MessageNode(
            vscode.workspace.workspaceFolders?.length
              ? 'Nothing found in the open folder — use + to attach another'
              : 'No folder open — use + to attach one',
            'folder-opened',
          ),
        );
      }

      const root = new GroupNode(SCOPE_HEADINGS[kind], children, SCOPE_ICONS[kind], 0);
      if (kind === 'workspace') {
        root.contextValue = 'workspaceGroup';
      }
      out.push(root);
    }
    return out;
  }

  private workspaceChildren(inScope: readonly Asset[]): Node[] {
    const scopes = this.collection.scopes
      .filter((s) => s.kind === 'workspace')
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));

    const out: Node[] = [];
    for (const scope of scopes) {
      // Assets carry the same Scope object, so identity is exact and needs no case rule.
      const list = inScope.filter((a) => a.scope.root === scope.root);
      // While filtering, an empty project is just noise -- the user is hunting something.
      if (list.length === 0 && this.filterText !== '') {
        continue;
      }

      const node = new GroupNode(scope.label, this.typeGroups(list, false, 2), 'folder', 1);
      node.scopeRoot = scope.root;
      node.contextValue = scope.attached ? 'attachedScope' : 'openScope';

      const tags: string[] = [];
      if (list.length === 0) {
        tags.push(scope.hasConfigDir ? 'no assets' : 'no .claude yet');
        node.iconPath = new vscode.ThemeIcon(
          'folder',
          new vscode.ThemeColor('disabledForeground'),
        );
      }
      if (scope.attached) {
        tags.push('attached');
      }
      node.description = [list.length > 0 ? String(list.length) : '', ...tags]
        .filter((t) => t !== '')
        .join(' · ');
      node.tooltip = scope.root;
      out.push(node);
    }
    return out;
  }

  private pluginChildren(inScope: readonly Asset[]): Node[] {
    const byLabel = new Map<string, Asset[]>();
    for (const asset of inScope) {
      const list = byLabel.get(asset.scope.label) ?? [];
      list.push(asset);
      byLabel.set(asset.scope.label, list);
    }
    return [...byLabel.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, list]) => new GroupNode(label, this.typeGroups(list, false, 2), 'extensions', 1));
  }

  /** All skills together, all hooks together, with a scope badge on every row. */
  private byType(assets: readonly Asset[]): Node[] {
    return this.typeGroups(assets, true, 0);
  }

  private typeGroups(assets: readonly Asset[], showScope: boolean, depth: number): Node[] {
    const out: Node[] = [];
    for (const kind of ASSET_ORDER) {
      const inKind = assets.filter((a) => a.kind === kind);
      if (inKind.length === 0) {
        continue;
      }
      const nodes = inKind
        .slice()
        .sort(byProblemThenName)
        .map((a) => new AssetNode(a, showScope));
      const group = new GroupNode(ASSET_LABELS[kind], nodes, iconForKind(kind), depth);
      // Lets the row carry a "what is this for?" action without stealing the click,
      // which has to keep meaning expand/collapse.
      group.assetKind = kind;
      group.contextValue = 'typeGroup';
      out.push(group);
    }
    return out;
  }
}

/**
 * Give every row a stable identity derived from what it IS, not from where it sits in
 * the list, so it survives a rebuild that reorders or adds siblings.
 */
function assignIds(nodes: readonly Node[], prefix: string): void {
  const used = new Map<string, number>();
  for (const node of nodes) {
    let key: string;
    if (node instanceof AssetNode) {
      key = `a:${node.asset.kind}:${node.asset.scope.root}:${node.asset.sourcePath}:${node.asset.name}`;
    } else if (node instanceof GroupNode) {
      key = `g:${node.scopeRoot ?? String(node.label)}`;
    } else if (node instanceof AccountNode) {
      key = 'account';
    } else {
      key = `m:${String(node.label)}`;
    }
    // Two rows can legitimately share a key (the same skill name in two scopes); a
    // counter keeps ids unique without making them positional for everyone else.
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);
    node.id = `${prefix}/${key}${seen > 0 ? `#${seen}` : ''}`;

    if (node instanceof GroupNode) {
      assignIds(node.children, node.id);
    }
  }
}

/** Reopen whatever the user had open before the rebuild. */
function restoreExpansion(nodes: readonly Node[], expanded: ReadonlySet<string>): void {
  for (const node of nodes) {
    if (!(node instanceof GroupNode) || node.children.length === 0) {
      continue;
    }
    if (node.id && expanded.has(node.id)) {
      node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    }
    restoreExpansion(node.children, expanded);
  }
}

/**
 * What the view actually depends on. Anything not in here -- a transcript being written,
 * a cache file touched -- must not cause a visible refresh.
 */
function fingerprint(collection: Collection): string {
  const assets = collection.assets.map((a) =>
    [a.kind, a.name, a.scope.root, a.sourcePath, a.modified ?? 0, a.problem ?? '', a.enabled ?? ''].join(''),
  );
  const scopes = collection.scopes.map((s) => [s.kind, s.label, s.root, s.hasConfigDir ?? '', s.attached ?? ''].join(''));
  return [collection.account.label, collection.account.signedIn, ...scopes, ...assets].join('');
}

/** Anything wrong floats to the top of its group -- that is the point of showing it. */
function byProblemThenName(a: Asset, b: Asset): number {
  const aBad = a.problem ? 0 : 1;
  const bBad = b.problem ? 0 : 1;
  return aBad !== bBad ? aBad - bBad : a.name.localeCompare(b.name);
}

function iconForKind(kind: AssetKind): string {
  const icons: Record<AssetKind, string> = {
    policy: 'law',
    setting: 'settings-gear',
    skill: 'lightbulb',
    command: 'terminal',
    agent: 'organization',
    rule: 'checklist',
    outputStyle: 'paintcan',
    theme: 'color-mode',
    workflow: 'run-all',
    hook: 'plug',
    mcp: 'server',
    lsp: 'symbol-namespace',
    plugin: 'extensions',
    keybinding: 'keyboard',
    plan: 'notebook',
    memory: 'book',
  };
  return icons[kind];
}
