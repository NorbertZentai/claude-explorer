import * as path from 'path';
import * as vscode from 'vscode';
import { CleanupCandidate, findCleanupCandidates } from '../analysis/cleanup';
import { applyJsonEdit } from '../edit/jsonFile';
import { removeHookText, removeListItemText } from '../edit/hookText';
import { ClaudeTreeProvider } from '../tree/provider';
import { isEditingAllowed } from '../tree/style';
import { confirm, reportErrors } from './ui';

/**
 * "Clean Up Configuration…": list the leftovers analysis/cleanup.ts finds, let the user
 * tick what goes, confirm once with the full list, then trash files and edit settings
 * files (each edit undoable in its editor).
 */
export function registerCleanupActions(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeExplorer.cleanup', () => reportErrors(() => cleanup(provider))),
  );
}

async function cleanup(provider: ClaudeTreeProvider): Promise<void> {
  if (!isEditingAllowed()) {
    throw new Error('Editing is turned off (claudeExplorer.allowEditing).');
  }
  const candidates = findCleanupCandidates(provider.getCollection());
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('Nothing to clean up: no missing hook scripts, stale approvals, expired plans, empty folders or broken links.');
    return;
  }

  type Item = vscode.QuickPickItem & { candidate?: CleanupCandidate };
  const items: Item[] = [];
  let category = '';
  for (const c of candidates.slice().sort((a, b) => a.category.localeCompare(b.category))) {
    if (c.category !== category) {
      category = c.category;
      items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({ label: c.label, description: `[${c.scopeLabel}]`, detail: c.reason, picked: c.preselected, candidate: c });
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: `Clean up Claude Code configuration: ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`,
    placeHolder: 'Tick what to remove. Files go to the Trash; settings edits can be undone in the editor.',
    canPickMany: true,
    matchOnDetail: true,
  });
  const chosen = (picked ?? []).map((i) => i.candidate).filter((c): c is CleanupCandidate => c !== undefined);
  if (chosen.length === 0) {
    return;
  }

  const lines = chosen.map((c) => `• ${c.category}: ${c.label}`);
  const ok = await confirm(
    `Remove ${chosen.length} item${chosen.length === 1 ? '' : 's'}?`,
    `${lines.slice(0, 15).join('\n')}${lines.length > 15 ? `\n…and ${lines.length - 15} more` : ''}`,
    'Remove',
  );
  if (!ok) {
    return;
  }

  const failures: string[] = [];
  // Settings edits first, grouped per file so each file is rewritten once.
  const byFile = new Map<string, CleanupCandidate[]>();
  for (const c of chosen) {
    if (c.action.type !== 'trash') {
      const list = byFile.get(c.action.file) ?? [];
      list.push(c);
      byFile.set(c.action.file, list);
    }
  }
  for (const [file, list] of byFile) {
    try {
      await applyJsonEdit(file, (text) =>
        list.reduce((current, c) => {
          const a = c.action;
          if (a.type === 'removeHook') {
            return removeHookText(current, file, a.hook);
          }
          return a.type === 'removeListItem' ? removeListItemText(current, file, a.key, a.value) : current;
        }, text),
      );
    } catch (err) {
      failures.push(`${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const c of chosen) {
    if (c.action.type !== 'trash') {
      continue;
    }
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(c.action.path), { recursive: true, useTrash: true });
    } catch (err) {
      failures.push(`${c.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  provider.refresh();
  if (failures.length > 0) {
    void vscode.window.showWarningMessage(`Cleaned up ${chosen.length - failures.length} of ${chosen.length}. Not removed: ${failures.join('; ')}`);
  } else {
    void vscode.window.showInformationMessage(`Cleaned up ${chosen.length} item${chosen.length === 1 ? '' : 's'}.`);
  }
}
