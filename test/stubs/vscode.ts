import * as nodePath from 'node:path';

/**
 * A hand-written stand-in for the `vscode` module, substituted by esbuild.test.mjs's `alias`.
 *
 * Only what the code under test touches. Everything else throws, so a test that wanders into
 * unstubbed API fails loudly instead of quietly doing nothing.
 *
 * Tests import `{ stub, reset }` from this same file, and esbuild keys modules by resolved
 * absolute path, so the test and the code under test share one instance per bundle.
 */

const notStubbed = (name: string): never => {
  throw new Error(`vscode.${name} is not stubbed -- add it to test/stubs/vscode.ts`);
};

export interface Disposable {
  dispose(): void;
}

const disposable = (): Disposable => ({ dispose: () => undefined });

// --- the control surface --------------------------------------------------------------------

/** A queued answer: a literal, or a chooser run against what the code offered. */
type Answer<In, Out> = Out | ((offered: In) => Out);

export interface Stub {
  /** Keyed `"<section>.<key>"`, e.g. `"claudeExplorer.allowEditing"`. */
  config: Record<string, unknown>;
  /** fsPaths; empty means `workspace.workspaceFolders === undefined`. */
  workspaceFolders: string[];
  terminals: FakeTerminal[];
  activeTerminal?: FakeTerminal;
  /** Set by window.onDidCloseTerminal; call it to simulate the user closing a terminal. */
  closeTerminal?: (terminal: FakeTerminal) => void;

  clipboard: string[];
  statusBar: string[];
  info: string[];
  errors: string[];
  shown: Array<{ kind: string; message: string; items: string[]; modal: boolean }>;
  /** What each showInputBox's validateInput returned for the answer given. */
  validations: unknown[];

  commands: Map<string, (...args: never[]) => unknown>;
  executed: Array<{ command: string; args: unknown[] }>;

  /** Queued returns for showWarningMessage / showInformationMessage / showErrorMessage. */
  answers: Array<Answer<string[], string | undefined>>;
  picks: Array<Answer<readonly unknown[], unknown>>;
  inputs: Array<Answer<Record<string, unknown>, string | undefined>>;
}

const blank = (): Stub => ({
  config: {},
  workspaceFolders: [],
  terminals: [],
  // Named explicitly although they are optional: Object.assign only overwrites keys the
  // source has, so leaving these out would leak one test's terminal into the next.
  activeTerminal: undefined,
  closeTerminal: undefined,
  clipboard: [],
  statusBar: [],
  info: [],
  errors: [],
  shown: [],
  validations: [],
  commands: new Map(),
  executed: [],
  answers: [],
  picks: [],
  inputs: [],
});

export const stub: Stub = blank();

/** Call in a beforeEach. Mutates in place so the exported reference stays valid. */
export function reset(over: Partial<Stub> = {}): Stub {
  Object.assign(stub, blank(), over);
  return stub;
}

const take = <In, Out>(queue: Array<Answer<In, Out>>, offered: In, what: string): Out => {
  if (queue.length === 0) {
    throw new Error(`${what} was called with no queued answer`);
  }
  const next = queue.shift() as Answer<In, Out>;
  return typeof next === 'function' ? (next as (o: In) => Out)(offered) : next;
};

// --- values ---------------------------------------------------------------------------------

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
  ) {}
  static file(p: string): Uri {
    return new Uri('file', '', p.replace(/\\/g, '/'));
  }
  static from(parts: { scheme: string; authority?: string; path?: string }): Uri {
    return new Uri(parts.scheme, parts.authority ?? '', parts.path ?? '');
  }
  static parse(value: string): Uri {
    const m = /^([a-z0-9+.-]+):(?:\/\/([^/]*))?(.*)$/i.exec(value);
    return m ? new Uri(m[1], m[2] ?? '', m[3]) : Uri.file(value);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, base.authority, nodePath.posix.join(base.path, ...segments));
  }
  /** Note: real VS Code lower-cases the drive letter here; this stub does not. */
  get fsPath(): string {
    return nodePath.normalize(this.path);
  }
  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}
}

export class MarkdownString {
  supportThemeIcons = false;
  isTrusted: boolean | { enabledCommands: string[] } = false;
  constructor(public value = '') {}
  appendText(text: string): this {
    this.value += text;
    return this;
  }
  appendMarkdown(md: string): this {
    this.value += md;
    return this;
  }
  appendCodeblock(code: string, language = ''): this {
    this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    return this;
  }
}

/** Real numeric values, so `TreeItemCollapsibleState.Expanded === 2` holds as in production. */
export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}
export enum InputBoxValidationSeverity {
  Ignore = 0,
  Information = 1,
  Warning = 2,
  Error = 3,
}
export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}
export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}
export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}
export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}
export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
}

export class TreeItem {
  id?: string;
  description?: string | boolean;
  tooltip?: string | MarkdownString;
  iconPath?: unknown;
  resourceUri?: Uri;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(
    public label: string,
    public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
  ) {}
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(e: T) => void>();
  /** Recorded so a test can assert the tree said it changed. */
  readonly fired: T[] = [];
  /**
   * An arrow PROPERTY, not a method: provider.ts does `readonly onX = this.emitter.event`,
   * which would lose `this` if this were on the prototype.
   */
  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };
  fire(data: T): void {
    this.fired.push(data);
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class FakeTerminal {
  readonly sent: Array<{ text: string; enter: boolean }> = [];
  shown = 0;
  constructor(
    readonly name: string,
    readonly options?: Record<string, unknown>,
  ) {}
  show(_preserveFocus?: boolean): void {
    this.shown += 1;
  }
  sendText(text: string, addNewLine = true): void {
    this.sent.push({ text, enter: addNewLine });
  }
  dispose(): void {
    stub.closeTerminal?.(this);
  }
}

// --- namespaces -----------------------------------------------------------------------------

export const workspace = {
  get workspaceFolders(): Array<{ uri: Uri; name: string; index: number }> | undefined {
    return stub.workspaceFolders.length === 0
      ? undefined
      : stub.workspaceFolders.map((p, index) => ({ uri: Uri.file(p), name: nodePath.basename(p), index }));
  },
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        const value = stub.config[`${section}.${key}`];
        return (value === undefined ? fallback : value) as T;
      },
    };
  },
  onDidChangeConfiguration: (): Disposable => disposable(),
  onDidChangeWorkspaceFolders: (): Disposable => disposable(),
  createFileSystemWatcher: () => ({
    onDidCreate: () => disposable(),
    onDidChange: () => disposable(),
    onDidDelete: () => disposable(),
    dispose: () => undefined,
  }),
  fs: {
    stat: async (_uri: Uri): Promise<never> => notStubbed('workspace.fs.stat'),
    createDirectory: async (_uri: Uri): Promise<never> => notStubbed('workspace.fs.createDirectory'),
    copy: async (): Promise<never> => notStubbed('workspace.fs.copy'),
    rename: async (): Promise<never> => notStubbed('workspace.fs.rename'),
    delete: async (): Promise<never> => notStubbed('workspace.fs.delete'),
    readFile: async (): Promise<never> => notStubbed('workspace.fs.readFile'),
    writeFile: async (): Promise<never> => notStubbed('workspace.fs.writeFile'),
    readDirectory: async (): Promise<never> => notStubbed('workspace.fs.readDirectory'),
  },
  applyEdit: async (): Promise<never> => notStubbed('workspace.applyEdit'),
  openTextDocument: async (): Promise<never> => notStubbed('workspace.openTextDocument'),
};

export const window = {
  get terminals(): readonly FakeTerminal[] {
    return stub.terminals;
  },
  get activeTerminal(): FakeTerminal | undefined {
    return stub.activeTerminal;
  },
  createTerminal(options: { name: string; cwd?: string; iconPath?: unknown }): FakeTerminal {
    const terminal = new FakeTerminal(options.name, options);
    stub.terminals.push(terminal);
    stub.activeTerminal = terminal;
    return terminal;
  },
  onDidCloseTerminal(cb: (t: FakeTerminal) => void): Disposable {
    stub.closeTerminal = (t) => {
      stub.terminals = stub.terminals.filter((x) => x !== t);
      if (stub.activeTerminal === t) {
        stub.activeTerminal = undefined;
      }
      cb(t);
    };
    return disposable();
  },
  async showWarningMessage(message: string, ...rest: unknown[]): Promise<string | undefined> {
    const modal = rest.some((r) => typeof r === 'object' && r !== null && (r as { modal?: boolean }).modal === true);
    const items = rest.filter((r): r is string => typeof r === 'string');
    stub.shown.push({ kind: 'warning', message, items, modal });
    return take(stub.answers, items, 'showWarningMessage');
  },
  async showInformationMessage(message: string, ...rest: unknown[]): Promise<string | undefined> {
    const items = rest.filter((r): r is string => typeof r === 'string');
    stub.info.push(message);
    stub.shown.push({ kind: 'information', message, items, modal: false });
    return items.length === 0 ? undefined : take(stub.answers, items, 'showInformationMessage');
  },
  async showErrorMessage(message: string, ...rest: unknown[]): Promise<string | undefined> {
    const items = rest.filter((r): r is string => typeof r === 'string');
    stub.errors.push(message);
    stub.shown.push({ kind: 'error', message, items, modal: false });
    return items.length === 0 ? undefined : take(stub.answers, items, 'showErrorMessage');
  },
  async showQuickPick(items: readonly unknown[], _options?: unknown): Promise<unknown> {
    const resolved = await items;
    return take(stub.picks, resolved, 'showQuickPick');
  },
  async showInputBox(options: Record<string, unknown> = {}): Promise<string | undefined> {
    const value = take(stub.inputs, options, 'showInputBox');
    // validateInput is a closure holding the real logic (validateItemName, the permission
    // check, the description length warning) that a test cannot reach any other way.
    const validate = options.validateInput as ((v: string) => unknown) | undefined;
    if (validate && value !== undefined) {
      stub.validations.push(await validate(value));
    }
    return value;
  },
  setStatusBarMessage(text: string, _ms?: number): Disposable {
    stub.statusBar.push(text);
    return disposable();
  },
  createStatusBarItem: () => ({
    text: '',
    tooltip: undefined as unknown,
    command: undefined as unknown,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  }),
  withProgress: <T>(_options: unknown, task: (p: { report(v: unknown): void }, t: unknown) => Thenable<T>): Thenable<T> =>
    task({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => disposable() }),
  registerFileDecorationProvider: (): Disposable => disposable(),
  createTreeView: () => ({ onDidExpandElement: () => disposable(), onDidCollapseElement: () => disposable(), dispose: () => undefined }),
  createQuickPick: (): never => notStubbed('window.createQuickPick'),
  showTextDocument: async (): Promise<never> => notStubbed('window.showTextDocument'),
  activeTextEditor: undefined as unknown,
  onDidChangeActiveTextEditor: (): Disposable => disposable(),
};

export const commands = {
  registerCommand(id: string, cb: (...args: never[]) => unknown): Disposable {
    stub.commands.set(id, cb);
    return disposable();
  },
  async executeCommand(command: string, ...args: unknown[]): Promise<undefined> {
    stub.executed.push({ command, args });
    return undefined;
  },
};

export const env = {
  clipboard: {
    async writeText(value: string): Promise<void> {
      stub.clipboard.push(value);
    },
    async readText(): Promise<string> {
      return stub.clipboard.at(-1) ?? '';
    },
  },
  async openExternal(uri: Uri): Promise<boolean> {
    return Boolean(uri);
  },
};

// Referenced by modules in the import graph, but not driven by any test yet.
export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
export class Range {
  constructor(
    readonly a: unknown,
    readonly b: unknown,
    readonly c?: unknown,
    readonly d?: unknown,
  ) {}
}
export class Selection extends Range {}
export class WorkspaceEdit {
  replace(): void {
    notStubbed('WorkspaceEdit.replace');
  }
}
export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string,
  ) {}
}
export const FileSystemError = {
  FileNotFound: (m?: string) => new Error(m ?? 'FileNotFound'),
  NoPermissions: (m?: string) => new Error(m ?? 'NoPermissions'),
};
