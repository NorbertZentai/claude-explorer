import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { effectiveSettings } from '../analysis/effectiveSettings';
import { whyNotLoaded } from '../analysis/whyNotLoaded';
import { asText, parseFrontmatter, rawFrontmatterLine } from '../discovery/frontmatter';
import { userClaudeDir } from '../discovery/scopes';
import { Asset, SkillOverride } from '../discovery/types';
import { setFrontmatterScalar } from '../edit/frontmatterText';
import { applyJsonEdit } from '../edit/jsonFile';
import { appendToRootArray, parseStrict, setValue } from '../edit/jsonText';
import { skillOverrideText } from '../edit/toggleText';
import { activeProjectRoot } from '../statusBar';
import { AssetNode } from '../tree/nodes';
import { ClaudeTreeProvider } from '../tree/provider';
import { isEditingAllowed } from '../tree/style';
import { claudeCommandLine, INVOCATION } from '../util/shell';
import { readText } from '../util/fs';
import { settingsFileChoices } from './itemActions';
import { confirm, reportErrors } from './ui';

/**
 * Acting on one item without opening its file: run it in a terminal, bind it to a key,
 * edit its description or visibility inline, compare it with what overrides it, and ask
 * why it is not in effect.
 *
 * Starting `claude` in a terminal is the one thing here that runs a program. It is always
 * visible (a terminal the user can see and stop) and confirmed the first time.
 */

const KEY_RUN_CONFIRMED = 'claudeExplorer.runConfirmed';

export function registerRunActions(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  const command = (id: string, run: (...args: never[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: never[]) => reportErrors(async () => run(...args))),
    );
  };

  command('claudeExplorer.runItem', (node?: AssetNode) => runItem(context, provider, node));
  command('claudeExplorer.runInvocation', (args?: { invocation?: unknown; args?: unknown; cwd?: unknown }) =>
    runFromKeybinding(context, provider, args),
  );
  command('claudeExplorer.assignKeybinding', (node?: AssetNode) => assignKeybinding(node));
  command('claudeExplorer.editDescription', (node?: AssetNode) => editDescription(provider, node));
  command('claudeExplorer.editSetting', (node?: AssetNode) => editSetting(provider, node));
  command('claudeExplorer.setSkillVisibility', (node?: AssetNode) => setSkillVisibility(provider, node));
  command('claudeExplorer.compareWithWinner', (node?: AssetNode) => compareWithWinner(node));
  command('claudeExplorer.whyNotLoaded', (node?: AssetNode) => showWhyNotLoaded(provider, node));
}

function requireEditing(): void {
  if (!isEditingAllowed()) {
    throw new Error('Editing is turned off (claudeExplorer.allowEditing).');
  }
}

// --- running -----------------------------------------------------------------------------

/**
 * Open a new terminal and start Claude Code with `prompt` as the first message. Returns
 * false when the user declined. Used by ▶ Run, keybindings, snippets and prompts.
 */
export async function sendToClaude(
  context: vscode.ExtensionContext,
  prompt: string,
  cwd: string | undefined,
  title: string,
): Promise<boolean> {
  const line = claudeCommandLine(prompt);
  if (!context.globalState.get<boolean>(KEY_RUN_CONFIRMED, false)) {
    const answer = await vscode.window.showWarningMessage(
      'Start Claude Code in a new terminal?',
      {
        modal: true,
        detail: `This opens a terminal${cwd ? ` in ${cwd}` : ''} and runs:\n\n${line.length > 300 ? `${line.slice(0, 300)}…` : line}\n\nClaude Code must be installed and on your PATH.`,
      },
      'Run',
      'Run and Don’t Ask Again',
    );
    if (!answer) {
      return false;
    }
    if (answer !== 'Run') {
      await context.globalState.update(KEY_RUN_CONFIRMED, true);
    }
  }
  const terminal = vscode.window.createTerminal({
    name: `Claude: ${title.length > 40 ? `${title.slice(0, 39)}…` : title}`,
    cwd: cwd && isDirectory(cwd) ? cwd : undefined,
    iconPath: new vscode.ThemeIcon('hubot'),
  });
  terminal.show();
  terminal.sendText(line, true);
  return true;
}

function cwdFor(provider: ClaudeTreeProvider, asset?: Asset): string | undefined {
  if (asset?.scope.kind === 'workspace') {
    return asset.scope.root;
  }
  return activeProjectRoot(provider) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function runItem(context: vscode.ExtensionContext, provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  const asset = node?.asset;
  if (!asset?.invocation || !INVOCATION.test(asset.invocation)) {
    return;
  }
  const hint = rawFrontmatterLine(readText(asset.sourcePath) ?? '', 'argument-hint');
  let args = '';
  if (hint) {
    const typed = await vscode.window.showInputBox({
      title: `Run ${asset.invocation}`,
      prompt: `Arguments: ${hint}`,
      placeHolder: hint,
    });
    if (typed === undefined) {
      return;
    }
    args = typed.trim();
  }
  await sendToClaude(context, args ? `${asset.invocation} ${args}` : asset.invocation, cwdFor(provider, asset), asset.invocation);
}

/**
 * The command a keybinding runs. Its arguments come from keybindings.json, so they are
 * validated as strictly as anything else from outside: a slash command and nothing more.
 */
async function runFromKeybinding(
  context: vscode.ExtensionContext,
  provider: ClaudeTreeProvider,
  input: { invocation?: unknown; args?: unknown; cwd?: unknown } | undefined,
): Promise<void> {
  const invocation = typeof input?.invocation === 'string' ? input.invocation.trim() : '';
  if (!INVOCATION.test(invocation)) {
    throw new Error('claudeExplorer.runInvocation needs an "invocation" argument such as "/deploy".');
  }
  const args = typeof input?.args === 'string' ? input.args.trim() : '';
  const cwd = typeof input?.cwd === 'string' && isDirectory(input.cwd) ? input.cwd : cwdFor(provider);
  await sendToClaude(context, args ? `${invocation} ${args}` : invocation, cwd, invocation);
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

async function assignKeybinding(node: AssetNode | undefined): Promise<void> {
  const asset = node?.asset;
  if (!asset?.invocation || !INVOCATION.test(asset.invocation)) {
    return;
  }
  const ok = await confirm(
    `Add a keybinding for ${asset.invocation}?`,
    'This opens your VS Code keybindings.json and adds an entry at the end with an empty "key". Type the key combination, then save the file. Nothing is saved for you.',
    'Add Entry',
  );
  if (!ok) {
    return;
  }
  await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/keybindings\.json$/i.test(editor.document.uri.path)) {
    throw new Error('Could not open keybindings.json. Open it with "Preferences: Open Keyboard Shortcuts (JSON)" and try again.');
  }
  const doc = editor.document;
  const entry: Record<string, unknown> = {
    key: '',
    command: 'claudeExplorer.runInvocation',
    args: { invocation: asset.invocation },
  };
  if (asset.scope.kind === 'workspace') {
    // A project command only exists in its project, so start Claude Code there.
    (entry.args as Record<string, unknown>).cwd = asset.scope.root;
  }
  const original = doc.getText();
  const { text } = appendToRootArray(original, entry);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)), text);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error('Could not edit keybindings.json.');
  }
  // Put the cursor inside the empty "key" of the entry just added.
  const updated = editor.document.getText();
  const marker = updated.lastIndexOf('"key": ""');
  if (marker !== -1) {
    const position = editor.document.positionAt(marker + '"key": "'.length);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
  void vscode.window.showInformationMessage(`Type a key combination for ${asset.invocation} between the quotes, then save.`);
}

// --- inline edits --------------------------------------------------------------------------

async function editDescription(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  requireEditing();
  const asset = node?.asset;
  if (!asset || asset.placeholder) {
    return;
  }
  const text = readText(asset.sourcePath);
  if (text === undefined) {
    throw new Error(`Cannot read ${asset.sourcePath}.`);
  }
  const { data } = parseFrontmatter(text);
  const current = asText(data.description) ?? '';
  const whenToUse = asText(data.when_to_use) ?? '';
  const limit = 1536;
  const value = await vscode.window.showInputBox({
    title: `Description of ${asset.invocation ?? asset.name}`,
    prompt:
      asset.kind === 'skill'
        ? 'What it does, then "Use when …". Claude decides when to load it from this.'
        : asset.kind === 'agent'
          ? 'Start with "Use this agent when …" so Claude delegates at the right time.'
          : 'One line shown in the / menu and to Claude.',
    value: current,
    valueSelection: [0, current.length],
    validateInput: (v) => {
      if (!v.trim()) {
        return 'Enter a description.';
      }
      if (/\n/.test(v)) {
        return 'One line only.';
      }
      const total = v.trim().length + (whenToUse ? whenToUse.length + 1 : 0);
      if (asset.kind === 'skill' && total > limit) {
        return {
          message: `description + when_to_use is ${total} characters; Claude Code cuts the listing at ${limit}.`,
          severity: vscode.InputBoxValidationSeverity.Warning,
        };
      }
      return undefined;
    },
  });
  if (value === undefined || value.trim() === current) {
    return;
  }
  const uri = vscode.Uri.file(asset.sourcePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const original = doc.getText();
  let next: string;
  try {
    next = setFrontmatterScalar(original, 'description', value.trim());
  } catch (err) {
    await vscode.window.showTextDocument(doc);
    throw err;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)), next);
  if (!(await vscode.workspace.applyEdit(edit)) || !(await doc.save())) {
    throw new Error(`Could not save ${asset.sourcePath}.`);
  }
  provider.refresh();
}

interface EditableSetting {
  key: string;
  label: string;
  choices?: string[];
  numeric?: boolean;
}

const EDITABLE_SETTINGS: EditableSetting[] = [
  { key: 'model', label: 'Model', choices: ['default', 'opus', 'sonnet', 'haiku', 'opusplan'] },
  { key: 'outputStyle', label: 'Output style' },
  { key: 'permissions.defaultMode', label: 'Permission mode sessions start in', choices: ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'] },
  { key: 'cleanupPeriodDays', label: 'Days to keep transcripts and plans', numeric: true },
];

async function editSetting(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  requireEditing();
  const fromRow = node?.asset.kind === 'setting' ? node.asset : undefined;
  const rowKey = fromRow?.name === 'permissions' ? 'permissions.defaultMode' : fromRow?.name;
  let setting = EDITABLE_SETTINGS.find((s) => s.key === rowKey);
  if (!setting) {
    const picked = await vscode.window.showQuickPick(
      EDITABLE_SETTINGS.map((s) => ({ label: s.key, description: s.label, setting: s })),
      { title: 'Change which setting?' },
    );
    if (!picked) {
      return;
    }
    setting = picked.setting;
  }
  const chosen = setting;

  const file =
    fromRow && fromRow.sourcePath.endsWith('.json')
      ? fromRow.sourcePath
      : (
          await vscode.window.showQuickPick(settingsFileChoices(provider.getCollection().scopes), {
            title: `Set ${chosen.key} in which settings file?`,
          })
        )?.file;
  if (!file) {
    return;
  }

  const pathParts = chosen.key.split('.');
  let value: string | number | undefined;
  if (chosen.choices) {
    const picked = await vscode.window.showQuickPick(
      [...chosen.choices, '(remove from this file)'],
      { title: `${chosen.key} in ${path.basename(path.dirname(file))}/${path.basename(file)}`, placeHolder: chosen.label },
    );
    if (!picked) {
      return;
    }
    value = picked === '(remove from this file)' ? undefined : picked;
  } else {
    const typed = await vscode.window.showInputBox({
      title: `${chosen.key} in ${path.basename(file)}`,
      prompt: `${chosen.label}. Leave empty to remove it from this file.`,
      validateInput: (v) => (chosen.numeric && v.trim() !== '' && !/^\d+$/.test(v.trim()) ? 'Enter a whole number.' : undefined),
    });
    if (typed === undefined) {
      return;
    }
    value = typed.trim() === '' ? undefined : chosen.numeric ? Number(typed.trim()) : typed.trim();
  }

  const project = path.basename(path.dirname(file)) === '.claude' && path.resolve(path.dirname(file)) !== path.resolve(userClaudeDir());
  const note =
    chosen.key === 'permissions.defaultMode' && (value === 'auto' || value === 'bypassPermissions') && project
      ? '\n\nClaude Code ignores auto and bypassPermissions from project settings; put it in user settings instead.'
      : '';
  const ok = await confirm(
    value === undefined ? `Remove ${chosen.key}?` : `Set ${chosen.key} to ${String(value)}?`,
    `File: ${file}${note}`,
    value === undefined ? 'Remove' : 'Set',
  );
  if (!ok) {
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)));
  await applyJsonEdit(file, (text) => {
    parseStrict(text, file);
    return setValue(text, pathParts, value);
  });
  provider.refresh();
}

const VISIBILITY: Array<{ state: SkillOverride; label: string; detail: string }> = [
  { state: 'on', label: 'On', detail: 'Claude sees the name and description; it is in the / menu. The default.' },
  { state: 'name-only', label: 'Name only', detail: 'Claude sees only the name, which saves context; still in the / menu.' },
  { state: 'user-invocable-only', label: 'Only when I type it', detail: 'Hidden from Claude; still in the / menu.' },
  { state: 'off', label: 'Off', detail: 'Hidden from Claude and from the / menu.' },
];

export async function setSkillVisibility(provider: ClaudeTreeProvider, node: AssetNode | undefined, preset?: SkillOverride): Promise<void> {
  requireEditing();
  const asset = node?.asset;
  const toggle = asset?.toggle;
  if (!asset || toggle?.target !== 'skill') {
    return;
  }
  const current = asset.skillOverride ?? 'on';
  const state =
    preset ??
    (
      await vscode.window.showQuickPick(
        VISIBILITY.map((v) => ({ label: `${v.state === current ? '$(check) ' : ''}${v.label}`, description: v.state, detail: v.detail, state: v.state })),
        { title: `Visibility of ${asset.invocation ?? asset.name} (skillOverrides)` },
      )
    )?.state;
  if (!state || state === current) {
    return;
  }
  const ok = await confirm(
    `Set ${asset.invocation ?? asset.name} to "${state}"?`,
    `This ${state === 'on' ? 'removes' : 'writes'} skillOverrides["${toggle.key}"] in ${toggle.file}. A higher-precedence settings file that names the same skill still wins. Running sessions pick it up after a restart.`,
    'Set',
  );
  if (!ok) {
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(toggle.file)));
  await applyJsonEdit(toggle.file, (text) => skillOverrideText(text, toggle.key, state));
  provider.refresh();
}

// --- understanding ----------------------------------------------------------------------------

async function compareWithWinner(node: AssetNode | undefined): Promise<void> {
  const asset = node?.asset;
  const o = asset?.overriddenBy;
  if (!asset || !o) {
    return;
  }
  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(asset.sourcePath),
    vscode.Uri.file(o.sourcePath),
    `${asset.invocation ?? asset.name} (${asset.scope.label}) ↔ ${o.name} (${o.scopeLabel}, wins)`,
  );
}

async function showWhyNotLoaded(provider: ClaudeTreeProvider, node: AssetNode | undefined): Promise<void> {
  const asset = node?.asset;
  if (!asset) {
    return;
  }
  const root = asset.scope.kind === 'workspace' ? asset.scope.root : activeProjectRoot(provider);
  const reasons = whyNotLoaded(asset, provider.getCollection().assets, effectiveSettings(root), root);
  const name = asset.invocation ?? asset.name;
  if (reasons.length === 0) {
    void vscode.window.showInformationMessage(
      `Nothing found that keeps ${name} out of a session${root ? ` in ${path.basename(root)}` : ''}. If Claude still ignores it, check the description, or run /context in Claude Code.`,
    );
    return;
  }
  const icon = { blocking: '$(error)', limiting: '$(warning)', check: '$(info)' };
  const picked = await vscode.window.showQuickPick(
    reasons.map((r) => ({ label: `${icon[r.kind]} ${r.text}`, description: r.sourcePath ? path.basename(r.sourcePath) : undefined, reason: r })),
    { title: `Why ${name} might not be in effect${root ? ` in ${path.basename(root)}` : ''}`, matchOnDescription: true },
  );
  if (picked?.reason.sourcePath) {
    const line = picked.reason.line ?? 0;
    await vscode.window.showTextDocument(vscode.Uri.file(picked.reason.sourcePath), { selection: new vscode.Range(line, 0, line, 0) });
  }
}
