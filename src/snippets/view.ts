import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { confirm, reportErrors } from '../commands/ui';
import { sendToClaude } from '../commands/runActions';
import { userClaudeDir } from '../discovery/scopes';
import { activeProjectRoot } from '../statusBar';
import { ClaudeTreeProvider } from '../tree/provider';
import { isEditingAllowed } from '../tree/style';
import { appendBlock, mergeSnippets, newId, parseSnippets, parseTagInput, serializeSnippets, Snippet, titleFrom } from './store';

/**
 * The Snippets view: a personal library of prompts and instructions, grouped by tag.
 *
 * Stored as one JSON file in VS Code's global storage for this extension, so it follows
 * the machine, not a project, and nothing is written into browsed folders. A snippet's text
 * opens as a real editor on the `claude-explorer-snippet:` scheme; saving writes it back.
 */

const SCHEME = 'claude-explorer-snippet';
const UNTAGGED = '(untagged)';

class SnippetStore {
  private snippets: Snippet[] = [];
  private loaded = false;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly storage: vscode.Uri) {}

  private get file(): vscode.Uri {
    return vscode.Uri.joinPath(this.storage, 'snippets.json');
  }

  async all(): Promise<Snippet[]> {
    if (!this.loaded) {
      try {
        this.snippets = parseSnippets(Buffer.from(await vscode.workspace.fs.readFile(this.file)).toString('utf8'));
      } catch {
        this.snippets = [];
      }
      this.loaded = true;
    }
    return this.snippets;
  }

  async get(id: string): Promise<Snippet | undefined> {
    return (await this.all()).find((s) => s.id === id);
  }

  async save(next: Snippet[]): Promise<void> {
    this.snippets = next;
    await vscode.workspace.fs.createDirectory(this.storage);
    await vscode.workspace.fs.writeFile(this.file, Buffer.from(serializeSnippets(next), 'utf8'));
    this.emitter.fire();
  }

  async upsert(snippet: Snippet): Promise<void> {
    const list = await this.all();
    const index = list.findIndex((s) => s.id === snippet.id);
    await this.save(index === -1 ? [...list, snippet] : list.map((s, i) => (i === index ? snippet : s)));
  }

  async remove(id: string): Promise<void> {
    await this.save((await this.all()).filter((s) => s.id !== id));
  }
}

class TagNode extends vscode.TreeItem {
  constructor(readonly tag: string, readonly snippets: Snippet[]) {
    super(tag === UNTAGGED ? tag : `#${tag}`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(tag === UNTAGGED ? 'circle-outline' : 'tag');
    this.description = String(snippets.length);
    this.contextValue = 'snippetTag';
    this.id = `tag:${tag}`;
  }
}

class SnippetNode extends vscode.TreeItem {
  constructor(readonly snippet: Snippet, tag: string) {
    super(snippet.title, vscode.TreeItemCollapsibleState.None);
    this.id = `snippet:${tag}:${snippet.id}`;
    this.iconPath = new vscode.ThemeIcon('note');
    const first = snippet.text.replace(/\s+/g, ' ').trim();
    this.description = first.length > 80 ? `${first.slice(0, 77)}…` : first;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${snippet.title.replace(/[\\`*_[\]]/g, '\\$&')}**`);
    if (snippet.tags.length > 0) {
      md.appendMarkdown(` · ${snippet.tags.map((t) => `#${t}`).join(' ')}`);
    }
    md.appendCodeblock(snippet.text.length > 1200 ? `${snippet.text.slice(0, 1200)}\n…` : snippet.text, 'markdown');
    md.appendMarkdown(`\n≈ ${Math.ceil(snippet.text.length / 4).toLocaleString('en-US')} tokens _(estimate)_`);
    this.tooltip = md;
    this.contextValue = 'snippet';
    this.command = { command: 'claudeExplorer.snippet.open', title: 'Edit Text', arguments: [this] };
  }
}

type Node = TagNode | SnippetNode;

class SnippetTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: SnippetStore) {
    store.onDidChange(() => this.emitter.fire());
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element instanceof TagNode) {
      return element.snippets.slice().sort((a, b) => a.title.localeCompare(b.title)).map((s) => new SnippetNode(s, element.tag));
    }
    if (element) {
      return [];
    }
    const all = await this.store.all();
    const tags = new Map<string, Snippet[]>();
    for (const s of all) {
      for (const tag of s.tags.length > 0 ? s.tags : [UNTAGGED]) {
        tags.set(tag, [...(tags.get(tag) ?? []), s]);
      }
    }
    return [...tags.entries()]
      .sort(([a], [b]) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)))
      .map(([tag, list]) => new TagNode(tag, list));
  }
}

/** Snippet text as an editable document: `claude-explorer-snippet:/<id>/<title>.md`. */
class SnippetFileSystem implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  constructor(private readonly store: SnippetStore) {}

  static uriFor(snippet: Snippet): vscode.Uri {
    const safe = snippet.title.replace(/[\\/:*?"<>|#%]/g, '-').slice(0, 60) || 'snippet';
    return vscode.Uri.from({ scheme: SCHEME, path: `/${snippet.id}/${safe}.md` });
  }

  private idOf(uri: vscode.Uri): string {
    return uri.path.split('/')[1] ?? '';
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const snippet = await this.store.get(this.idOf(uri));
    if (!snippet) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { type: vscode.FileType.File, ctime: snippet.created, mtime: snippet.updated, size: Buffer.byteLength(snippet.text) };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const snippet = await this.store.get(this.idOf(uri));
    if (!snippet) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return Buffer.from(snippet.text, 'utf8');
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const snippet = await this.store.get(this.idOf(uri));
    if (!snippet) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    await this.store.upsert({ ...snippet, text: Buffer.from(content).toString('utf8'), updated: Date.now() });
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}

export function registerSnippets(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  const store = new SnippetStore(context.globalStorageUri);
  const tree = new SnippetTree(store);
  const view = vscode.window.createTreeView('claudeExplorer.snippets', { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(
    view,
    vscode.workspace.registerFileSystemProvider(SCHEME, new SnippetFileSystem(store), { isCaseSensitive: true }),
  );

  const command = (id: string, run: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, (...args: never[]) => reportErrors(async () => run(...args))));
  };

  const pick = async (node: unknown): Promise<Snippet | undefined> => {
    if (node instanceof SnippetNode) {
      return (await store.get(node.snippet.id)) ?? node.snippet;
    }
    const all = await store.all();
    if (all.length === 0) {
      void vscode.window.showInformationMessage('No snippets yet. Create one with "New Snippet".');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      all.map((s) => ({ label: s.title, description: s.tags.map((t) => `#${t}`).join(' '), detail: s.text.replace(/\s+/g, ' ').slice(0, 120), snippet: s })),
      { title: 'Which snippet?', matchOnDescription: true, matchOnDetail: true },
    );
    return picked?.snippet;
  };

  const create = async (text: string): Promise<void> => {
    const title = await vscode.window.showInputBox({
      title: 'New snippet',
      prompt: 'A short name you will recognise in the list.',
      value: text ? titleFrom(text) : '',
      validateInput: (v) => (v.trim() ? undefined : 'Enter a title.'),
    });
    if (!title) {
      return;
    }
    const tags = await vscode.window.showInputBox({
      title: `Tags for "${title.trim()}"`,
      prompt: 'Optional, separated by commas or spaces: e.g. review, testing',
    });
    if (tags === undefined) {
      return;
    }
    const now = Date.now();
    const snippet: Snippet = { id: newId(), title: title.trim(), text, tags: parseTagInput(tags), created: now, updated: now };
    await store.upsert(snippet);
    if (!text) {
      await vscode.window.showTextDocument(SnippetFileSystem.uriFor(snippet));
      void vscode.window.showInformationMessage('Write the snippet text, then save (Cmd/Ctrl+S).');
    }
  };

  command('claudeExplorer.snippet.new', () => {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
    return create(selected);
  });
  command('claudeExplorer.snippet.fromSelection', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      throw new Error('Select the text to keep as a snippet first.');
    }
    return create(editor.document.getText(editor.selection));
  });
  command('claudeExplorer.snippet.open', async (node?: SnippetNode) => {
    const snippet = await pick(node);
    if (snippet) {
      await vscode.window.showTextDocument(SnippetFileSystem.uriFor(snippet), { preview: true });
    }
  });
  command('claudeExplorer.snippet.rename', async (node?: SnippetNode) => {
    const snippet = await pick(node);
    const title = snippet && (await vscode.window.showInputBox({ title: 'Rename snippet', value: snippet.title, validateInput: (v) => (v.trim() ? undefined : 'Enter a title.') }));
    if (snippet && title && title.trim() !== snippet.title) {
      await store.upsert({ ...snippet, title: title.trim(), updated: Date.now() });
    }
  });
  command('claudeExplorer.snippet.tag', async (node?: SnippetNode) => {
    const snippet = await pick(node);
    const tags = snippet && (await vscode.window.showInputBox({ title: `Tags for "${snippet.title}"`, prompt: 'Separated by commas or spaces. Empty removes all tags.', value: snippet.tags.join(', ') }));
    if (snippet && tags !== undefined) {
      await store.upsert({ ...snippet, tags: parseTagInput(tags), updated: Date.now() });
    }
  });
  command('claudeExplorer.snippet.delete', async (node?: SnippetNode) => {
    const snippet = await pick(node);
    if (snippet && (await confirm(`Delete the snippet "${snippet.title}"?`, 'This cannot be undone. Export your snippets first if you want a copy.', 'Delete'))) {
      await store.remove(snippet.id);
    }
  });
  command('claudeExplorer.snippet.copy', async (node?: SnippetNode) => {
    const snippet = await pick(node);
    if (snippet) {
      await vscode.env.clipboard.writeText(snippet.text);
      void vscode.window.setStatusBarMessage(`Copied "${snippet.title}"`, 3000);
    }
  });
  command('claudeExplorer.snippet.send', async (node?: SnippetNode) => {
    const snippet = await pick(node);
    if (snippet) {
      await sendToClaude(context, snippet.text, activeProjectRoot(provider), snippet.title);
    }
  });
  command('claudeExplorer.snippet.insert', async (node?: SnippetNode) => {
    if (!isEditingAllowed()) {
      throw new Error('Editing is turned off (claudeExplorer.allowEditing).');
    }
    const snippet = await pick(node);
    if (snippet) {
      await insertInto(provider, snippet);
    }
  });
  command('claudeExplorer.snippet.export', async () => {
    const all = await store.all();
    const target = await vscode.window.showSaveDialog({
      title: 'Export snippets',
      defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(), 'claude-snippets.json')),
      filters: { JSON: ['json'] },
    });
    if (target) {
      await vscode.workspace.fs.writeFile(target, Buffer.from(serializeSnippets(all), 'utf8'));
      void vscode.window.showInformationMessage(`Exported ${all.length} snippet${all.length === 1 ? '' : 's'}.`);
    }
  });
  command('claudeExplorer.snippet.import', async () => {
    const picked = await vscode.window.showOpenDialog({ title: 'Import snippets', canSelectMany: false, filters: { JSON: ['json'] } });
    if (!picked?.[0]) {
      return;
    }
    const incoming = parseSnippets(Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8'));
    if (incoming.length === 0) {
      throw new Error('No snippets found in that file.');
    }
    const merged = mergeSnippets(await store.all(), incoming);
    await store.save(merged.snippets);
    void vscode.window.showInformationMessage(`Imported ${merged.added} snippet${merged.added === 1 ? '' : 's'}${merged.added < incoming.length ? ` (${incoming.length - merged.added} already there)` : ''}.`);
  });
}

/** Append a snippet to a memory file or rule the user picks, after a confirmation. */
async function insertInto(provider: ClaudeTreeProvider, snippet: Snippet): Promise<void> {
  const { scopes, assets } = provider.getCollection();
  type Target = vscode.QuickPickItem & { file?: string; newRuleIn?: string };
  const items: Target[] = [
    { label: 'User', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(account) ~/.claude/CLAUDE.md', description: 'every project', file: path.join(userClaudeDir(), 'CLAUDE.md') },
    { label: '$(new-file) New user rule…', description: '~/.claude/rules/', newRuleIn: path.join(userClaudeDir(), 'rules') },
  ];
  for (const scope of scopes.filter((s) => s.kind === 'workspace')) {
    items.push(
      { label: scope.label, kind: vscode.QuickPickItemKind.Separator },
      { label: '$(folder) CLAUDE.md', description: 'shared with the team', file: path.join(scope.root, 'CLAUDE.md') },
      { label: '$(lock) CLAUDE.local.md', description: 'only you, not committed', file: path.join(scope.root, 'CLAUDE.local.md') },
      { label: '$(new-file) New project rule…', description: '.claude/rules/', newRuleIn: path.join(scope.root, '.claude', 'rules') },
    );
  }
  const rules = assets.filter((a) => a.kind === 'rule' && !a.placeholder && (a.scope.kind === 'user' || a.scope.kind === 'workspace'));
  if (rules.length > 0) {
    items.push({ label: 'Existing rules', kind: vscode.QuickPickItemKind.Separator });
    items.push(...rules.map((r) => ({ label: `$(checklist) ${r.name}`, description: `[${r.scope.label}]`, file: r.sourcePath })));
  }
  const target = await vscode.window.showQuickPick(items, { title: `Insert "${snippet.title}" into…` });
  if (!target) {
    return;
  }
  let file = target.file;
  let prefix = '';
  if (target.newRuleIn) {
    const name = await vscode.window.showInputBox({
      title: 'New rule file name',
      value: snippet.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rule',
      validateInput: (v) => (/^[a-z0-9][a-z0-9-_]*$/.test(v.trim()) ? undefined : 'Lowercase letters, numbers, - and _.'),
    });
    if (!name) {
      return;
    }
    const paths = await vscode.window.showInputBox({
      title: 'Only for some files?',
      prompt: 'Optional glob such as src/**/*.ts. Empty loads the rule in every session.',
    });
    if (paths === undefined) {
      return;
    }
    file = path.join(target.newRuleIn, `${name.trim()}.md`);
    prefix = paths.trim() ? `---\npaths:\n  - "${paths.trim().replace(/"/g, '\\"')}"\n---\n\n` : '';
  }
  if (!file) {
    return;
  }
  const uri = vscode.Uri.file(file);
  let exists = true;
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    exists = false;
  }
  const tokens = Math.ceil(snippet.text.length / 4);
  const ok = await confirm(
    `${exists ? 'Append' : 'Create'} ${path.basename(file)} with "${snippet.title}"?`,
    `${file}\n\nAdds about ${tokens.toLocaleString('en-US')} tokens${prefix ? ' when matching files are read' : ' to every session that loads this file'} (estimate).`,
    exists ? 'Append' : 'Create',
  );
  if (!ok) {
    return;
  }
  if (!exists) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(appendBlock('', prefix + snippet.text), 'utf8'));
  } else {
    const doc = await vscode.workspace.openTextDocument(uri);
    const original = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)), appendBlock(original, snippet.text));
    if (!(await vscode.workspace.applyEdit(edit)) || !(await doc.save())) {
      throw new Error(`Could not save ${file}.`);
    }
  }
  provider.refresh();
  await vscode.window.showTextDocument(uri, { preview: true });
}
