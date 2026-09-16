import * as path from 'path';
import * as vscode from 'vscode';
import { HOOK_EVENTS, TimelineHook, TOOL_EVENTS } from '../analysis/hookTimeline';
import { confirm } from '../commands/ui';
import { userClaudeDir } from '../discovery/scopes';
import { applyJsonEdit } from '../edit/jsonFile';
import { findHook, HookIdentity, insertHookText, removeHookText, updateHookText } from '../edit/hookText';
import { isEditingAllowed } from '../tree/style';
import { readText } from '../util/fs';
import { redactCommandLine } from '../util/redact';

/**
 * Hook edits started from the Overview's timeline: drag a hook to another event or settings
 * file, or pick an edit from its menu. The page only sends an index; the declaration is
 * looked up here, so no raw command ever travels through the webview.
 */

export type Layer = 'user' | 'project' | 'local';

export function layerFile(layer: Layer, root: string | undefined): string | undefined {
  if (layer === 'user') {
    return path.join(userClaudeDir(), 'settings.json');
  }
  if (!root) {
    return undefined;
  }
  return path.join(root, '.claude', layer === 'local' ? 'settings.local.json' : 'settings.json');
}

function describe(h: TimelineHook): string {
  return `${h.declaration.event}${h.declaration.matcher ? ` · ${h.declaration.matcher}` : ''}: ${redactCommandLine(h.declaration.command.split(/\s+/))}`;
}

function identity(h: TimelineHook): HookIdentity {
  return { event: h.declaration.event, matcher: h.declaration.matcher, command: h.declaration.command };
}

/** Move a hook to another event and/or settings file. Insert first, then remove, so a failure never loses it. */
export async function moveHook(hook: TimelineHook, toEvent: string, toFile: string): Promise<boolean> {
  if (!isEditingAllowed() || !hook.editable) {
    return false;
  }
  const from = hook.declaration.file;
  if (toEvent === hook.declaration.event && path.resolve(toFile) === path.resolve(from)) {
    return false;
  }
  const matcher = TOOL_EVENTS.has(toEvent) ? hook.declaration.matcher : undefined;
  const lostMatcher = hook.declaration.matcher && !matcher ? `\n\nThe matcher "${hook.declaration.matcher}" is dropped: ${toEvent} does not match on tool names.` : '';
  const ok = await confirm(
    `Move this hook${toEvent !== hook.declaration.event ? ` to ${toEvent}` : ''}${path.resolve(toFile) !== path.resolve(from) ? ` into ${shortFile(toFile)}` : ''}?`,
    `${describe(hook)}\n\nFrom: ${from}\nTo: ${toFile}${lostMatcher}`,
    'Move',
  );
  if (!ok) {
    return false;
  }
  if (path.resolve(toFile) === path.resolve(from)) {
    await applyJsonEdit(from, (text) => updateHookText(text, from, identity(hook), { event: toEvent, matcher, command: hook.declaration.command }));
    return true;
  }
  const handler = findHook(readText(from) ?? '', from, identity(hook));
  if (!handler) {
    throw new Error(`That hook is no longer in ${from}. Refresh and try again.`);
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(toFile)));
  await applyJsonEdit(toFile, (text) => insertHookText(text, toFile, toEvent, matcher, handler));
  await applyJsonEdit(from, (text) => removeHookText(text, from, identity(hook)));
  return true;
}

export async function editHook(hook: TimelineHook, root: string | undefined): Promise<boolean> {
  if (!isEditingAllowed() || !hook.editable) {
    return false;
  }
  const d = hook.declaration;
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(symbol-event) Change event…', id: 'event' },
      ...(TOOL_EVENTS.has(d.event) ? [{ label: '$(filter) Change matcher…', description: d.matcher ?? '(all tools)', id: 'matcher' }] : []),
      { label: '$(terminal) Change command…', id: 'command' },
      { label: '$(file-symlink-file) Move to another settings file…', description: shortFile(d.file), id: 'file' },
      { label: '$(go-to-file) Open where it is declared', id: 'open' },
      { label: '$(trash) Delete this hook', id: 'delete' },
    ],
    { title: describe(hook) },
  );
  if (!action) {
    return false;
  }
  switch (action.id) {
    case 'event': {
      const picked = await vscode.window.showQuickPick(
        HOOK_EVENTS.filter((e) => e.name !== d.event).map((e) => ({ label: e.name, description: e.when })),
        { title: 'Move to which event?', matchOnDescription: true },
      );
      return picked ? moveHook(hook, picked.label, d.file) : false;
    }
    case 'file': {
      const choices = (['user', 'project', 'local'] as Layer[])
        .map((layer) => ({ layer, file: layerFile(layer, root) }))
        .filter((c): c is { layer: Layer; file: string } => c.file !== undefined && path.resolve(c.file) !== path.resolve(d.file));
      const picked = await vscode.window.showQuickPick(
        choices.map((c) => ({
          label: c.layer === 'user' ? '$(account) User settings' : c.layer === 'project' ? '$(folder) Project, shared' : '$(lock) Project, only you',
          description: c.file,
          file: c.file,
        })),
        { title: 'Move into which settings file?' },
      );
      return picked ? moveHook(hook, d.event, picked.file) : false;
    }
    case 'matcher': {
      const typed = await vscode.window.showInputBox({
        title: `Matcher for this ${d.event} hook`,
        prompt: 'A tool name, a | list, or a regular expression. Leave empty for every tool.',
        value: d.matcher ?? '',
      });
      if (typed === undefined || typed.trim() === (d.matcher ?? '')) {
        return false;
      }
      return applyUpdate(hook, { event: d.event, matcher: typed.trim() || undefined, command: d.command });
    }
    case 'command': {
      const typed = await vscode.window.showInputBox({
        title: `Command for this ${d.event} hook`,
        prompt: 'Runs with the event JSON on stdin. Exit code 2 blocks the action on events that can block.',
        value: d.command,
        validateInput: (v) => (v.trim() ? undefined : 'Enter a command.'),
      });
      if (typed === undefined || typed.trim() === d.command) {
        return false;
      }
      return applyUpdate(hook, { event: d.event, matcher: d.matcher, command: typed.trim() });
    }
    case 'open': {
      const line = hook.line ?? 0;
      await vscode.window.showTextDocument(vscode.Uri.file(d.file), { selection: new vscode.Range(line, 0, line, 0) });
      return false;
    }
    case 'delete': {
      const ok = await confirm('Delete this hook?', `${describe(hook)}\n\nFrom: ${d.file}\n\nThe script file, if any, is left in place. Undo in the editor.`, 'Delete');
      if (!ok) {
        return false;
      }
      await applyJsonEdit(d.file, (text) => removeHookText(text, d.file, identity(hook)));
      return true;
    }
  }
  return false;
}

async function applyUpdate(hook: TimelineHook, next: HookIdentity): Promise<boolean> {
  const d = hook.declaration;
  const ok = await confirm('Update this hook?', `${describe(hook)}\n\nFile: ${d.file}`, 'Update');
  if (!ok) {
    return false;
  }
  await applyJsonEdit(d.file, (text) => updateHookText(text, d.file, identity(hook), next));
  return true;
}

function shortFile(file: string): string {
  return path.join(path.basename(path.dirname(file)), path.basename(file));
}
