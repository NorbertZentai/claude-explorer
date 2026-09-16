import * as path from 'path';
import * as vscode from 'vscode';
import { userClaudeDir } from '../discovery/scopes';
import { surfaceDirs } from '../discovery/surfaces';
import { draftSkillPrompt, PAGE_PROMPTS, PERSONAL_PREFERENCES, personalisePrompt, workspaceSetupPrompt } from '../prompts';
import { activeProjectRoot } from '../statusBar';
import { AssetNode, GroupNode } from '../tree/nodes';
import { ClaudeTreeProvider } from '../tree/provider';
import { sendToClaude } from './runActions';
import { reportErrors } from './ui';
import { validateItemName } from './itemActions';

/**
 * Prompt-driven setup: instead of templates, hand Claude Code a precise request and let it
 * look at the project. Each prompt can be copied or sent straight to a new Claude Code
 * session in a terminal. Prompts contain only what the user typed or picked, plus paths.
 */
export function registerPromptActions(context: vscode.ExtensionContext, provider: ClaudeTreeProvider): void {
  const command = (id: string, run: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, (...args: never[]) => reportErrors(async () => run(...args))));
  };

  command('claudeExplorer.setUpWithClaude', async (node?: GroupNode) => {
    const root = node?.scopeRoot ?? (await pickProject(provider));
    if (!root) {
      return;
    }
    await deliverPrompt(context, workspaceSetupPrompt(path.basename(root)), root, 'Set up Claude Code', 'Set up Claude Code for this project');
  });

  command('claudeExplorer.hardenSecurity', async (node?: AssetNode) => {
    const root = node?.asset.scope.kind === 'workspace' ? node.asset.scope.root : activeProjectRoot(provider);
    await deliverPrompt(context, PAGE_PROMPTS.securityHardening, root, 'Security hardening', 'Tighten permissions and sandbox settings');
  });

  command('claudeExplorer.draftSkill', async (node?: GroupNode) => {
    let scope = node?.createTarget?.scope;
    if (!scope) {
      const scopes = provider.getCollection().scopes.filter((s) => s.kind === 'user' || s.kind === 'workspace');
      const picked = await vscode.window.showQuickPick(
        scopes.map((s) => ({ label: s.kind === 'user' ? '$(account) User' : `$(folder) ${s.label}`, description: s.kind === 'user' ? 'available in every project' : s.root, scope: s })),
        { title: 'Where should the new skill live?' },
      );
      scope = picked?.scope;
    }
    if (!scope) {
      return;
    }
    const base = scope.kind === 'user' ? userClaudeDir() : scope.root;
    const dir = surfaceDirs('skill', scope.kind, base)[0];
    if (!dir) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: `Draft a skill with Claude (${scope.label})`,
      prompt: 'The skill name, which is also the command you type.',
      placeHolder: 'backup-database',
      validateInput: (v) => validateItemName(v, dir, ''),
    });
    if (!name) {
      return;
    }
    const purpose = await vscode.window.showInputBox({
      title: `What should /${name.trim()} do?`,
      prompt: 'In a sentence or two: what it does, and when it should be used.',
      placeHolder: 'Dump the local Postgres database to backups/ with a timestamp, before risky migrations.',
      validateInput: (v) => (v.trim() ? undefined : 'Describe what the skill should do.'),
    });
    if (!purpose) {
      return;
    }
    const file = path.join(dir, name.trim(), 'SKILL.md');
    await deliverPrompt(context, draftSkillPrompt(name.trim(), purpose, file), scope.kind === 'workspace' ? scope.root : activeProjectRoot(provider), `Draft /${name.trim()}`, `Draft the ${name.trim()} skill`);
  });

  command('claudeExplorer.personalise', async () => {
    const picked = await vscode.window.showQuickPick(
      [
        ...PERSONAL_PREFERENCES.map((p) => ({ label: p })),
        { label: '$(edit) Something else…', custom: true },
      ],
      { title: 'Personalise Claude Code: which preferences?', canPickMany: true },
    );
    if (!picked || picked.length === 0) {
      return;
    }
    const preferences = picked.filter((p) => !('custom' in p)).map((p) => p.label);
    if (picked.some((p) => 'custom' in p)) {
      const typed = await vscode.window.showInputBox({ title: 'Your own preference', prompt: 'One instruction, e.g. "Prefer functional components in React".' });
      if (typed?.trim()) {
        preferences.push(typed.trim());
      }
    }
    if (preferences.length === 0) {
      return;
    }
    await deliverPrompt(context, personalisePrompt(preferences), activeProjectRoot(provider), 'Personalise', 'Update ~/.claude/CLAUDE.md with your preferences');
  });
}

async function pickProject(provider: ClaudeTreeProvider): Promise<string | undefined> {
  const projects = provider.getCollection().scopes.filter((s) => s.kind === 'workspace');
  if (projects.length <= 1) {
    return projects[0]?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
  const picked = await vscode.window.showQuickPick(projects.map((p) => ({ label: p.label, description: p.root, root: p.root })), { title: 'Which project?' });
  return picked?.root;
}

/** Copy the prompt, or start Claude Code with it in a terminal. */
export async function deliverPrompt(context: vscode.ExtensionContext, text: string, cwd: string | undefined, title: string, what: string): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(play) Send to Claude Code', description: cwd ? `new terminal in ${path.basename(cwd)}` : 'new terminal', send: true },
      { label: '$(copy) Copy prompt', description: 'paste it into a running session', send: false },
    ],
    { title: what, placeHolder: text.length > 160 ? `${text.slice(0, 157)}…` : text },
  );
  if (!choice) {
    return;
  }
  if (choice.send) {
    await sendToClaude(context, text, cwd, title);
  } else {
    await vscode.env.clipboard.writeText(text);
    void vscode.window.setStatusBarMessage('Copied prompt. Paste it into Claude Code.', 4000);
  }
}
