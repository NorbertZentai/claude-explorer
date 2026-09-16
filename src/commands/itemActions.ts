import * as path from 'path';
import * as vscode from 'vscode';
import { estimateBudget, mcpMeasurementKey } from '../analysis/contextBudget';
import { winnerBetween } from '../analysis/overrides';
import { renderReport } from '../analysis/report';
import { lintSkill } from '../analysis/skillLint';
import { userClaudeDir } from '../discovery/scopes';
import { surfaceDirs } from '../discovery/surfaces';
import { Asset, Scope } from '../discovery/types';
import { DashboardPanel, RevealTarget } from '../dashboard/panel';
import { renameFrontmatterName } from '../edit/frontmatterText';
import { applyJsonEdit } from '../edit/jsonFile';
import { appendToList, parseStrict } from '../edit/jsonText';
import { buildAddCommand } from '../mcp/addCommand';
import { expandVars, readServer, transportOf } from '../mcp/definition';
import { probeStdioServer, ProbeError } from '../mcp/probe';
import { promptsFor } from '../prompts';
import { AssetNode, GroupNode } from '../tree/nodes';
import { ClaudeTreeProvider } from '../tree/provider';
import { isEditingAllowed } from '../tree/style';
import { readJson } from '../util/fs';
import { redactCommandLine, redactText } from '../util/redact';
import { confirm, reportErrors } from './ui';

/**
 * Commands that act on one row of the tree, from its inline icons or its context menu.
 * Everything that writes checks `allowEditing` again here, not only in the menu `when`
 * clauses, because a command can also be invoked with a stale node.
 */
export function registerItemActions(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  const command = (id: string, run: (...args: never[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: never[]) => reportErrors(async () => run(...args))),
    );
  };

  command('claudeExplorer.openFolder', (node?: GroupNode) => openFolder(node));
  command('claudeExplorer.copyReference', (node?: AssetNode) => copyReference(node));
  command('claudeExplorer.revealInDashboard', (node?: AssetNode) => revealInDashboard(context, provider, node));
  command('claudeExplorer.copyToScope', (node?: AssetNode) => copyToScope(provider, node));
  command('claudeExplorer.renameItem', (node?: AssetNode) => renameItem(provider, node));
  command('claudeExplorer.deleteItem', (node?: AssetNode) => deleteItem(provider, node));
  command('claudeExplorer.addPermissionRule', (node?: AssetNode | GroupNode) => addPermissionRule(provider, node));
  command('claudeExplorer.lintSkill', (node?: AssetNode) => showSkillLint(node));
  command('claudeExplorer.copyMcpAddCommand', (node?: AssetNode) => copyMcpAddCommand(node));
  command('claudeExplorer.testMcpServer', (node?: AssetNode) => testMcpServer(provider, node));
  command('claudeExplorer.copyPrompt', (node?: AssetNode) => copyPrompt(provider, node));
  command('claudeExplorer.exportReport', (node?: GroupNode) => exportReport(provider, node));
}

// --- read-only ----------------------------------------------------------------------

async function openFolder(node: GroupNode | undefined): Promise<void> {
  const folders = node?.folders ?? [];
  const folder =
    folders.length <= 1
      ? folders[0]
      : (await vscode.window.showQuickPick(folders, { title: `Open which ${String(node?.label)} folder?` }));
  if (folder) {
    await vscode.env.openExternal(vscode.Uri.file(folder));
  }
}

async function copyReference(node: AssetNode | undefined): Promise<void> {
  if (!node) {
    return;
  }
  const reference = referenceFor(node.asset);
  await vscode.env.clipboard.writeText(reference);
  void vscode.window.setStatusBarMessage(`Copied ${reference}`, 3000);
}

/**
 * `@path` for pasting into Claude Code: relative to the item's project (or the first open
 * folder) when the file is inside it, absolute otherwise.
 */
export function referenceFor(asset: Pick<Asset, 'scope' | 'sourcePath'>): string {
  const root = asset.scope.kind === 'workspace' ? asset.scope.root : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const relative = root ? path.relative(root, asset.sourcePath) : '';
  const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  return `@${inside ? relative.split(path.sep).join('/') : asset.sourcePath}`;
}

function revealInDashboard(context: vscode.ExtensionContext, provider: ClaudeTreeProvider, node: AssetNode | undefined): void {
  if (!node) {
    return;
  }
  const a = node.asset;
  let target: RevealTarget;
  if (a.overriddenBy) {
    target = { section: 'overrides', key: a.sourcePath };
  } else if (a.problem) {
    target = { section: 'problems', key: a.sourcePath };
  } else if (a.kind === 'hook') {
    target = { section: 'hooks', key: `hook:${a.sourcePath}` };
  } else if (a.kind === 'setting') {
    target = { section: 'settings', key: a.name.endsWith('.json') ? `source:${a.sourcePath}` : `setting:${a.name}` };
  } else {
    target = { section: 'budget', key: a.sourcePath };
  }
  if (a.scope.kind === 'workspace') {
    target.root = a.scope.root;
  }
  DashboardPanel.show(context, provider, target);
}

async function showSkillLint(node: AssetNode | undefined): Promise<void> {
  if (!node || node.asset.kind !== 'skill') {
    return;
  }
  const file = node.asset.sourcePath;
  const findings = lintSkill(file);
  if (findings.length === 0) {
    void vscode.window.showInformationMessage(`${node.asset.invocation ?? node.asset.name}: no issues found.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    findings.map((f) => ({
      label: `${f.severity === 'warning' ? '$(warning)' : '$(info)'} ${f.message}`,
      description: f.line !== undefined ? `line ${f.line + 1}` : undefined,
      finding: f,
    })),
    {
      title: `${node.asset.invocation ?? node.asset.name}: ${findings.length} finding${findings.length === 1 ? '' : 's'}`,
      matchOnDescription: true,
    },
  );
  if (picked) {
    const line = picked.finding.line ?? 0;
    await vscode.window.showTextDocument(vscode.Uri.file(file), { selection: new vscode.Range(line, 0, line, 0) });
  }
}

async function copyPrompt(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  if (!node) {
    return;
  }
  const asset = node.asset;
  const { assets } = provider.getCollection();
  const winner = asset.overriddenBy && assets.find((a) => a.sourcePath === asset.overriddenBy!.sourcePath && !a.placeholder);
  const root = asset.scope.kind === 'workspace' ? asset.scope.root : undefined;
  const tokens =
    asset.kind === 'memory' || asset.kind === 'rule'
      ? estimateBudget(assets, root, provider.getMcpMeasurements()).rows.find((r) => r.sourcePath === asset.sourcePath)?.tokens
      : undefined;
  const prompts = promptsFor(asset, { ref: referenceFor(asset), winnerRef: winner && referenceFor(winner), tokens });
  const picked = await vscode.window.showQuickPick(
    prompts.map((p) => ({ label: p.label, description: p.detail, prompt: p })),
    { title: `Copy a prompt about ${asset.invocation ?? asset.name}`, matchOnDescription: true },
  );
  if (picked) {
    await vscode.env.clipboard.writeText(picked.prompt.text);
    void vscode.window.setStatusBarMessage('Copied prompt. Paste it into Claude Code.', 4000);
  }
}

async function copyMcpAddCommand(node: AssetNode | undefined): Promise<void> {
  const server = node && readServer(node.asset.sourcePath, node.asset.name);
  if (!node || !server) {
    throw new Error('Could not read this server from its .mcp.json.');
  }
  const text = buildAddCommand(node.asset.name, server, node.asset.scope.kind === 'workspace');
  await vscode.env.clipboard.writeText(text);
  const placeholders = text.includes('<value>');
  void vscode.window.showInformationMessage(
    placeholders
      ? `Copied the claude mcp add command for "${node.asset.name}". Replace the <value> placeholders before running it.`
      : `Copied the claude mcp add command for "${node.asset.name}".`,
  );
}

async function exportReport(provider: ClaudeTreeProvider, node: GroupNode | undefined): Promise<void> {
  if (!node?.reportTarget) {
    return;
  }
  const { assets, scopes } = provider.getCollection();
  const content = renderReport(assets, scopes, node.reportTarget, new Date());
  // An untitled document: nothing is written until the user decides to save it.
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(doc);
}

// --- running a server ------------------------------------------------------------------

async function testMcpServer(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  const asset = node?.asset;
  const server = asset && readServer(asset.sourcePath, asset.name);
  if (!asset || !server) {
    throw new Error('Could not read this server from its .mcp.json.');
  }
  if (transportOf(server) !== 'stdio' || !server.command) {
    void vscode.window.showInformationMessage(
      `"${asset.name}" is a ${transportOf(server)} server. Only stdio servers can be tested for now, so no network request is made.`,
    );
    return;
  }

  const cwd = asset.scope.root;
  const vars: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_PROJECT_DIR: asset.scope.kind === 'workspace' ? cwd : process.env.CLAUDE_PROJECT_DIR,
    CLAUDE_PLUGIN_ROOT: asset.scope.kind === 'plugin' ? cwd : undefined,
  };
  const cmd = expandVars(server.command, vars);
  const args = (server.args ?? []).map((a) => expandVars(String(a), vars));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(server.env ?? {})) {
    env[key] = expandVars(String(value), vars);
  }

  const ok = await confirm(
    `Start MCP server "${asset.name}" on this machine?`,
    `It runs: ${redactCommandLine([cmd, ...args])}\nin ${cwd}\n\nIt is stopped as soon as it has listed its tools, or after 20 seconds.`,
    'Start',
  );
  if (!ok) {
    return;
  }

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Testing MCP server "${asset.name}"…`, cancellable: true },
      (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        return probeStdioServer({ command: cmd, args, env, cwd, signal: abort.signal });
      },
    );
    provider.recordMcpMeasurement(mcpMeasurementKey(asset.sourcePath, asset.name), {
      tools: result.tools.length,
      chars: result.chars,
    });
    const tokens = Math.ceil(result.chars / 4).toLocaleString('en-US');
    const answer = await vscode.window.showInformationMessage(
      `${asset.name}: ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} · ≈ ${tokens} tokens of tool definitions (estimate).`,
      'Show Tools',
    );
    if (answer === 'Show Tools') {
      const lines = [
        `# ${asset.name}: ${result.tools.length} tools`,
        '',
        result.serverName ? `Server reports itself as **${result.serverName}**${result.serverVersion ? ` ${result.serverVersion}` : ''}.` : '',
        '',
        ...result.tools.map((t) => `- **${t.name}**${t.description ? `: ${t.description.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`),
      ];
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
      await vscode.window.showTextDocument(doc);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = err instanceof ProbeError ? redactText(err.stderrTail) : '';
    const answer = await vscode.window.showErrorMessage(
      `MCP server "${asset.name}" failed: ${message}`,
      ...(stderr ? ['Show Output'] : []),
    );
    if (answer === 'Show Output') {
      const doc = await vscode.workspace.openTextDocument({
        language: 'log',
        content: `Last lines the server wrote to stderr (credential-like words masked):\n\n${stderr}\n`,
      });
      await vscode.window.showTextDocument(doc);
    }
  }
}

// --- writing ---------------------------------------------------------------------------

/** The file or folder an asset *is*: a skill is its folder, everything else its file. */
function unitOf(asset: Asset): { uri: vscode.Uri; name: string; isDir: boolean } {
  if (asset.kind === 'skill') {
    const dir = path.dirname(asset.sourcePath);
    return { uri: vscode.Uri.file(dir), name: path.basename(dir), isDir: true };
  }
  return { uri: vscode.Uri.file(asset.sourcePath), name: path.basename(asset.sourcePath), isDir: false };
}

function requireEditing(): void {
  if (!isEditingAllowed()) {
    throw new Error('Editing is turned off (claudeExplorer.allowEditing).');
  }
}

/**
 * A name for a new or renamed item. Blocks what cannot be a file name or already exists;
 * warns (without blocking) when it is not kebab-case, since it becomes the `/command`.
 */
export async function validateItemName(
  value: string,
  parentDir: string,
  ext: string,
): Promise<vscode.InputBoxValidationMessage | undefined> {
  const trimmed = value.trim();
  const error = (message: string): vscode.InputBoxValidationMessage => ({
    message,
    severity: vscode.InputBoxValidationSeverity.Error,
  });
  if (!trimmed) {
    return error('Enter a name.');
  }
  if (/[\\/:*?"<>|]/.test(trimmed) || trimmed.startsWith('.')) {
    return error('Use letters, numbers, - and _; no slashes or leading dot.');
  }
  if (await exists(vscode.Uri.file(path.join(parentDir, trimmed + ext)))) {
    return error(`${trimmed + ext} already exists here.`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    return {
      message: 'Lowercase letters, numbers and hyphens are the convention, since the name becomes the command.',
      severity: vscode.InputBoxValidationSeverity.Warning,
    };
  }
  return undefined;
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function copyToScope(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  requireEditing();
  if (!node) {
    return;
  }
  const asset = node.asset;
  const { assets, scopes } = provider.getCollection();
  const targets: Array<{ scope: Scope; base: string; label: string; detail: string }> = [];
  const user = scopes.find((s) => s.kind === 'user');
  if (user && asset.scope.kind !== 'user') {
    targets.push({ scope: user, base: userClaudeDir(), label: '$(account) User', detail: 'available in every project' });
  }
  for (const scope of scopes.filter((s) => s.kind === 'workspace' && s.root !== asset.scope.root)) {
    targets.push({ scope, base: scope.root, label: `$(folder) ${scope.label}`, detail: scope.root });
  }
  const picked = await vscode.window.showQuickPick(
    targets.map((t) => ({ label: t.label, description: t.detail, target: t })),
    { title: `Copy ${asset.invocation ?? asset.name} to…` },
  );
  if (!picked) {
    return;
  }
  const { scope, base } = picked.target;
  const destDir = surfaceDirs(asset.kind, scope.kind, base)[0];
  if (!destDir) {
    throw new Error(`${scope.label} has no place for this kind of item.`);
  }
  const unit = unitOf(asset);
  const dest = vscode.Uri.file(path.join(destDir, unit.name));

  // Would the copy shadow something, or be shadowed? Same rules as the tree's overrides.
  const copy: Asset = { ...asset, scope, overriddenBy: undefined };
  const warnings = assets
    .filter((other) => !other.placeholder && other !== asset && sharesSession(other.scope, scope))
    .concat(asset)
    .flatMap((other) => {
      const winner = winnerBetween(copy, other);
      if (!winner) {
        return [];
      }
      return winner === copy
        ? [`The copy will take precedence over ${other.invocation ?? other.name} in ${other.scope.label}.`]
        : [`The copy will be overridden by ${other.invocation ?? other.name} in ${other.scope.label}.`];
    });
  const replacing = await exists(dest);
  const ok = await confirm(
    `${replacing ? 'Replace' : 'Copy'} ${asset.invocation ?? asset.name} in ${scope.label}?`,
    [`To: ${dest.fsPath}`, replacing ? 'An item with this name already exists there and will be replaced.' : '', ...warnings]
      .filter(Boolean)
      .join('\n\n'),
    replacing ? 'Replace' : 'Copy',
  );
  if (!ok) {
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(destDir));
  await vscode.workspace.fs.copy(unit.uri, dest, { overwrite: true });
  provider.refresh();
  await vscode.window.showTextDocument(unit.isDir ? vscode.Uri.joinPath(dest, 'SKILL.md') : dest);
}

/** A copy into `target` meets `other` in some Claude Code session. */
export function sharesSession(other: Scope, target: Scope): boolean {
  if (other.kind === 'system' || other.kind === 'user' || other.kind === 'plugin') {
    return true;
  }
  return target.kind === 'user' || other.root === target.root;
}

async function renameItem(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  requireEditing();
  if (!node) {
    return;
  }
  const asset = node.asset;
  const unit = unitOf(asset);
  const ext = unit.isDir ? '' : path.extname(unit.name);
  const oldName = unit.isDir ? unit.name : path.basename(unit.name, ext);
  const parent = path.dirname(unit.uri.fsPath);

  const newName = await vscode.window.showInputBox({
    title: `Rename ${asset.invocation ?? asset.name}`,
    prompt:
      asset.kind === 'skill'
        ? 'The folder name is the command you type, e.g. deploy-staging → /deploy-staging.'
        : asset.kind === 'command'
          ? 'The file name is the command you type.'
          : undefined,
    value: oldName,
    valueSelection: [0, oldName.length],
    validateInput: (value) => (value.trim() === oldName ? undefined : validateItemName(value, parent, ext)),
  });
  if (!newName || newName.trim() === oldName) {
    return;
  }
  const target = vscode.Uri.file(path.join(parent, newName.trim() + ext));
  await vscode.workspace.fs.rename(unit.uri, target);

  // Keep the frontmatter in step. An agent's `name` is its identity, so it always follows;
  // for the rest, a display name the author chose on purpose is left alone.
  const markdown = unit.isDir ? vscode.Uri.joinPath(target, 'SKILL.md') : target;
  if (markdown.fsPath.endsWith('.md')) {
    const text = Buffer.from(await vscode.workspace.fs.readFile(markdown)).toString('utf8');
    const updated = renameFrontmatterName(text, newName.trim(), asset.kind === 'agent' ? undefined : oldName);
    if (updated !== text) {
      await vscode.workspace.fs.writeFile(markdown, Buffer.from(updated, 'utf8'));
    }
  }
  provider.refresh();
}

async function deleteItem(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  requireEditing();
  if (!node) {
    return;
  }
  const asset = node.asset;
  const unit = unitOf(asset);
  const files = unit.isDir ? await countFiles(unit.uri) : 1;
  const ok = await confirm(
    `Move ${asset.invocation ?? asset.name} to the Trash?`,
    `${unit.uri.fsPath}${unit.isDir ? `\n\nThe whole folder goes, ${files} file${files === 1 ? '' : 's'}.` : ''}\n\nYou can restore it from the Trash.`,
    'Move to Trash',
  );
  if (!ok) {
    return;
  }
  await vscode.workspace.fs.delete(unit.uri, { recursive: true, useTrash: true });
  provider.refresh();
}

async function countFiles(dir: vscode.Uri): Promise<number> {
  let total = 0;
  for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
    total += type === vscode.FileType.Directory ? await countFiles(vscode.Uri.joinPath(dir, name)) : 1;
  }
  return total;
}

type PermissionList = 'allow' | 'ask' | 'deny';

async function addPermissionRule(provider: ClaudeTreeProvider, node: AssetNode | GroupNode | undefined): Promise<void> {
  requireEditing();
  const list = await vscode.window.showQuickPick(
    [
      { label: '$(pass) Allow', description: 'runs without asking', list: 'allow' as PermissionList },
      { label: '$(question) Ask', description: 'always asks first', list: 'ask' as PermissionList },
      { label: '$(circle-slash) Deny', description: 'never runs', list: 'deny' as PermissionList },
    ],
    { title: 'Add a permission rule', placeHolder: 'Rules are checked deny → ask → allow; the first match decides.' },
  );
  if (!list) {
    return;
  }

  const rule = await vscode.window.showInputBox({
    title: `Add a permission rule: ${list.list}`,
    prompt: 'A tool name, optionally with a specifier.',
    placeHolder: 'Bash(npm run *)   Read(./.env)   WebFetch(domain:example.com)   mcp__github',
    validateInput: (value) => {
      const v = value.trim();
      if (!v) {
        return 'Enter a rule.';
      }
      if (/^mcp__\S*\(/.test(v)) {
        return 'Claude Code skips mcp__ rules with parentheses in settings files. Use mcp__server or mcp__server__tool.';
      }
      if (!/^[A-Za-z_*][\w*-]*(\(.+\))?$/.test(v)) {
        return 'Expected Tool or Tool(specifier), for example Bash(npm test).';
      }
      return undefined;
    },
  });
  if (!rule) {
    return;
  }
  const trimmed = rule.trim();

  const here = node instanceof AssetNode && node.asset.name === 'permissions' ? node.asset.sourcePath : undefined;
  const target = await vscode.window.showQuickPick(settingsFileChoices(provider.getCollection().scopes, here), {
    title: `Add ${trimmed} to which settings file?`,
  });
  if (!target) {
    return;
  }

  const permissions = readJson<{ permissions?: Record<string, unknown> }>(target.file)?.permissions ?? {};
  const has = (name: PermissionList): boolean => Array.isArray(permissions[name]) && (permissions[name] as unknown[]).includes(trimmed);
  if (has(list.list)) {
    void vscode.window.showInformationMessage(`${trimmed} is already in permissions.${list.list} of this file.`);
    return;
  }
  const elsewhere = (['allow', 'ask', 'deny'] as PermissionList[]).filter((l) => l !== list.list && has(l));
  const ok = await confirm(
    `Add ${trimmed} to permissions.${list.list}?`,
    [
      `File: ${target.file}`,
      elsewhere.length > 0
        ? `It is also in permissions.${elsewhere.join(' and ')} of this file. Deny is checked first, then ask, then allow.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    'Add',
  );
  if (!ok) {
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.file)));
  await applyJsonEdit(target.file, (text) => {
    parseStrict(text, target.file);
    return appendToList(text, ['permissions', list.list], trimmed);
  });
  provider.refresh();
}

/**
 * The settings files a new rule or hook can go into, `preferFile` first when given:
 * shared and local for each open project, then the user file.
 */
export function settingsFileChoices(
  scopes: readonly Scope[],
  preferFile?: string,
  onlyRoot?: string,
): Array<{ label: string; description: string; file: string }> {
  const out: Array<{ label: string; description: string; file: string }> = [];
  for (const scope of scopes.filter((s) => s.kind === 'workspace' && (onlyRoot === undefined || s.root === onlyRoot))) {
    out.push(
      { label: `$(folder) ${scope.label}: project`, description: 'shared with the team · .claude/settings.json', file: path.join(scope.root, '.claude', 'settings.json') },
      { label: `$(folder) ${scope.label}: project local`, description: 'only you · .claude/settings.local.json', file: path.join(scope.root, '.claude', 'settings.local.json') },
    );
  }
  if (onlyRoot === undefined) {
    out.push({ label: '$(account) User', description: 'all your projects · ~/.claude/settings.json', file: path.join(userClaudeDir(), 'settings.json') });
  }
  if (preferFile && !out.some((c) => c.file === preferFile)) {
    out.unshift({ label: '$(file) This file', description: preferFile, file: preferFile });
  }
  return out.sort((a, b) => (a.file === preferFile ? -1 : b.file === preferFile ? 1 : 0));
}
