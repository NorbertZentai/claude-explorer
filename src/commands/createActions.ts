import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { HOOK_EVENTS } from '../analysis/hookTimeline';
import { winnerBetween } from '../analysis/overrides';
import { userClaudeDir } from '../discovery/scopes';
import { surfaceDirs } from '../discovery/surfaces';
import { Asset, AssetKind, Scope } from '../discovery/types';
import { applyJsonEdit } from '../edit/jsonFile';
import { appendToList, parseStrict } from '../edit/jsonText';
import {
  claudeMdSkeleton,
  CreatableFileKind,
  gitignoreAdditions,
  hookScriptTemplate,
  settingsSkeleton,
  templateFor,
} from '../edit/templates';
import { AssetNode, GroupNode } from '../tree/nodes';
import { ClaudeTreeProvider } from '../tree/provider';
import { isEditingAllowed } from '../tree/style';
import { isDir, isFile, readText } from '../util/fs';
import { exists, settingsFileChoices, sharesSession, validateItemName } from './itemActions';
import { confirm, reportErrors } from './ui';

/** Creating configuration: a new item from a template, and a first `.claude` for a project. */
export function registerCreateActions(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeExplorer.createItem', (node?: GroupNode | AssetNode) =>
      reportErrors(() => createItem(provider, node)),
    ),
    vscode.commands.registerCommand('claudeExplorer.initClaudeDir', (node?: GroupNode) =>
      reportErrors(() => initClaudeDir(provider, node)),
    ),
  );
}

interface CreateTarget {
  scope: Scope;
  base: string;
}

/** Hook events whose matcher is a tool name; the others ignore it. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

async function createItem(provider: ClaudeTreeProvider, node: GroupNode | AssetNode | undefined): Promise<void> {
  if (!isEditingAllowed()) {
    throw new Error('Editing is turned off (claudeExplorer.allowEditing).');
  }
  const kind: AssetKind | undefined = node instanceof GroupNode ? node.assetKind : node?.asset.kind;
  if (!kind) {
    return;
  }
  const target =
    node instanceof GroupNode
      ? (node.createTarget ?? (await pickTarget(provider, kind)))
      : node?.asset.placeholder
        ? targetFor(node.asset.scope)
        : undefined;
  if (!target) {
    return;
  }
  if (kind === 'hook') {
    await createHook(provider, target);
  } else {
    await createFile(provider, kind as CreatableFileKind, target);
  }
}

export function targetFor(scope: Scope): CreateTarget {
  return { scope, base: scope.kind === 'user' ? userClaudeDir() : scope.root };
}

async function pickTarget(provider: ClaudeTreeProvider, kind: AssetKind): Promise<CreateTarget | undefined> {
  const scopes = provider.getCollection().scopes.filter((s) => s.kind === 'user' || s.kind === 'workspace');
  const picked = await vscode.window.showQuickPick(
    scopes.map((s) => ({
      label: s.kind === 'user' ? '$(account) User' : `$(folder) ${s.label}`,
      description: s.kind === 'user' ? 'available in every project' : s.root,
      scope: s,
    })),
    { title: `Where should the new ${kind} live?` },
  );
  return picked && targetFor(picked.scope);
}

async function createFile(provider: ClaudeTreeProvider, kind: CreatableFileKind, target: CreateTarget): Promise<void> {
  const dir = surfaceDirs(kind, target.scope.kind, target.base)[0];
  if (!dir) {
    throw new Error(`${target.scope.label} has no place for a ${kind}.`);
  }
  const ext = kind === 'skill' ? '' : '.md';
  const { assets } = provider.getCollection();

  const name = await vscode.window.showInputBox({
    title: `New ${kind} in ${target.scope.label}`,
    prompt: kind === 'skill' || kind === 'command' ? 'The name is the command you type.' : undefined,
    placeHolder: kind === 'skill' ? 'deploy-staging' : kind === 'agent' ? 'code-reviewer' : 'my-' + kind.toLowerCase(),
    validateInput: async (value) => {
      const basic = await validateItemName(value, dir, ext);
      if (basic?.severity === vscode.InputBoxValidationSeverity.Error) {
        return basic;
      }
      const conflict = conflictNote({ kind, name: value.trim(), scope: target.scope, sourcePath: '' }, assets);
      return conflict ? { message: conflict, severity: vscode.InputBoxValidationSeverity.Warning } : basic;
    },
  });
  if (!name) {
    return;
  }

  const template = templateFor(kind, name.trim());
  const file = vscode.Uri.file(path.join(dir, template.relPath));
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file.fsPath)));
  await vscode.workspace.fs.writeFile(file, Buffer.from(template.content, 'utf8'));
  provider.refresh();

  const editor = await vscode.window.showTextDocument(file);
  const at = template.content.indexOf(template.select);
  if (at !== -1) {
    const start = editor.document.positionAt(at);
    editor.selection = new vscode.Selection(start, editor.document.positionAt(at + template.select.length));
    editor.revealRange(editor.selection);
  }
}

/** One sentence when a new item would shadow, or be shadowed by, an existing one. */
function conflictNote(candidate: Pick<Asset, 'kind' | 'name' | 'scope' | 'sourcePath'>, assets: readonly Asset[]): string | undefined {
  const draft = candidate as Asset;
  for (const other of assets) {
    if (other.placeholder || !sharesSession(other.scope, draft.scope)) {
      continue;
    }
    const winner = winnerBetween(draft, other);
    if (winner) {
      return winner === draft
        ? `It will take precedence over ${other.invocation ?? other.name} in ${other.scope.label}.`
        : `${other.invocation ?? other.name} in ${other.scope.label} will take precedence over it.`;
    }
  }
  return undefined;
}

async function createHook(provider: ClaudeTreeProvider, target: CreateTarget): Promise<void> {
  const event = await vscode.window.showQuickPick(
    HOOK_EVENTS.map((e) => ({ label: e.name, description: e.when })),
    { title: 'New hook: which event?', matchOnDescription: true },
  );
  if (!event) {
    return;
  }

  let matcher: string | undefined;
  if (TOOL_EVENTS.has(event.label)) {
    const typed = await vscode.window.showInputBox({
      title: `New ${event.label} hook: which tools?`,
      prompt: 'A tool name, a | list, or a regular expression. Leave empty for every tool.',
      placeHolder: 'Bash   Edit|Write   mcp__github__.*',
    });
    if (typed === undefined) {
      return;
    }
    matcher = typed.trim() || undefined;
  }

  const handler = await vscode.window.showQuickPick(
    [
      { label: '$(new-file) New script file', description: 'a bash script that reads the event JSON', script: true },
      { label: '$(terminal) Command line', description: 'run an existing command', script: false },
    ],
    { title: `New ${event.label} hook: what should run?` },
  );
  if (!handler) {
    return;
  }

  const isUser = target.scope.kind === 'user';
  const hooksDir = isUser ? path.join(target.base, 'hooks') : path.join(target.base, '.claude', 'hooks');
  let command: string;
  let scriptFile: string | undefined;
  if (handler.script) {
    const name = await vscode.window.showInputBox({
      title: 'Script name',
      placeHolder: 'guard-bash',
      validateInput: (value) => validateItemName(value, hooksDir, '.sh'),
    });
    if (!name) {
      return;
    }
    scriptFile = path.join(hooksDir, `${name.trim()}.sh`);
    // Quoted and variable-based, the form the hook reader resolves, so a later missing
    // script is still reported.
    const defaultUserDir = path.join(os.homedir(), '.claude');
    command = isUser
      ? target.base === defaultUserDir
        ? `bash "$HOME/.claude/hooks/${name.trim()}.sh"`
        : `bash "${scriptFile}"`
      : `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/${name.trim()}.sh"`;
  } else {
    const typed = await vscode.window.showInputBox({ title: 'Command to run', placeHolder: 'npx prettier --write "$CLAUDE_PROJECT_DIR"' });
    if (!typed?.trim()) {
      return;
    }
    command = typed.trim();
  }

  const settingsFile = isUser
    ? path.join(target.base, 'settings.json')
    : (
        await vscode.window.showQuickPick(settingsFileChoices(provider.getCollection().scopes, undefined, target.scope.root), {
          title: 'Declare the hook in which settings file?',
        })
      )?.file;
  if (!settingsFile) {
    return;
  }

  const ok = await confirm(
    `Add a ${event.label} hook?`,
    [
      `Runs: ${command}`,
      TOOL_EVENTS.has(event.label) ? `For tools: ${matcher ?? 'all'}` : '',
      scriptFile ? `Creates: ${scriptFile}` : '',
      `Declared in: ${settingsFile}`,
    ]
      .filter(Boolean)
      .join('\n'),
    'Add Hook',
  );
  if (!ok) {
    return;
  }

  if (scriptFile) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(hooksDir));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(scriptFile), Buffer.from(hookScriptTemplate(event.label), 'utf8'));
    if (process.platform !== 'win32') {
      await fsp.chmod(scriptFile, 0o755);
    }
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(settingsFile)));
  const entry = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] };
  await applyJsonEdit(settingsFile, (text) => {
    parseStrict(text, settingsFile);
    return appendToList(text, ['hooks', event.label], entry);
  });
  provider.refresh();
  if (scriptFile) {
    await vscode.window.showTextDocument(vscode.Uri.file(scriptFile));
  }
}

async function initClaudeDir(provider: ClaudeTreeProvider, node: GroupNode | undefined): Promise<void> {
  if (!isEditingAllowed()) {
    throw new Error('Editing is turned off (claudeExplorer.allowEditing).');
  }
  const root = node?.scopeRoot;
  if (!root) {
    return;
  }
  const settingsFile = path.join(root, '.claude', 'settings.json');
  const claudeMd = path.join(root, 'CLAUDE.md');
  const gitignore = path.join(root, '.gitignore');
  const ignoreText = isFile(gitignore) ? (readText(gitignore) ?? '') : '';
  const ignoreAdd = isDir(path.join(root, '.git')) ? gitignoreAdditions(ignoreText) : '';

  const options = [
    !(await exists(vscode.Uri.file(settingsFile))) && {
      label: '.claude/settings.json',
      description: 'with the JSON schema, for completion while editing',
      id: 'settings',
    },
    !isFile(claudeMd) && !isFile(path.join(root, '.claude', 'CLAUDE.md')) && {
      label: 'CLAUDE.md',
      description: 'a short outline for project instructions',
      id: 'claudeMd',
    },
    ignoreAdd !== '' && {
      label: '.gitignore',
      description: 'ignore .claude/settings.local.json and CLAUDE.local.md',
      id: 'gitignore',
    },
  ].filter((o): o is { label: string; description: string; id: string } => Boolean(o));
  if (options.length === 0) {
    void vscode.window.showInformationMessage('Everything is already in place.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    options.map((o) => ({ ...o, picked: true })),
    { title: `Set up Claude Code in ${path.basename(root)}`, canPickMany: true },
  );
  if (!picked || picked.length === 0) {
    return;
  }
  const ok = await confirm(
    `Set up Claude Code in ${path.basename(root)}?`,
    picked.map((p) => `${p.id === 'gitignore' ? 'Append to' : 'Create'} ${path.join(root, p.label)}`).join('\n'),
    'Create',
  );
  if (!ok) {
    return;
  }

  const ids = new Set(picked.map((p) => p.id));
  if (ids.has('settings')) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(settingsFile)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(settingsFile), Buffer.from(settingsSkeleton(), 'utf8'));
  }
  if (ids.has('claudeMd')) {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(claudeMd), Buffer.from(claudeMdSkeleton(path.basename(root)), 'utf8'));
  }
  if (ids.has('gitignore')) {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(gitignore), Buffer.from(ignoreText + ignoreAdd, 'utf8'));
  }
  provider.refresh();
  await vscode.window.showTextDocument(vscode.Uri.file(ids.has('claudeMd') ? claudeMd : settingsFile));
  void vscode.window.showInformationMessage('Tip: running /init in Claude Code fills CLAUDE.md in from the codebase.');
}
