import * as vscode from 'vscode';
import { AssetKind, ScopeKind } from '../discovery/types';

/**
 * Colour for the tree, kept deliberately sparse: the four scope headings carry a
 * tint, type groups share one muted icon colour, and every asset row stays in the normal
 * foreground. The colours are contributed in package.json (`contributes.colors`) as
 * per-theme defaults (dark, light, high contrast), so users can retune them in `workbench.colorCustomizations`.
 */

// Distinct from the `claude-explorer` scheme the guide documents are served under.
export const DECORATION_SCHEME = 'claude-explorer-tone';

export const KIND_ICONS: Record<AssetKind, string> = {
  policy: 'law',
  setting: 'settings-gear',
  skill: 'lightbulb',
  command: 'terminal',
  agent: 'person',
  rule: 'checklist',
  outputStyle: 'paintcan',
  theme: 'color-mode',
  workflow: 'run-all',
  hook: 'plug',
  mcp: 'server-process',
  lsp: 'symbol-namespace',
  plugin: 'extensions',
  keybinding: 'keyboard',
  plan: 'notebook',
  memory: 'book',
};

/** A type group holds many of its kind, so it gets a plural-looking icon where one exists. */
export const KIND_GROUP_ICONS: Record<AssetKind, string> = {
  ...KIND_ICONS,
  agent: 'organization',
  mcp: 'server',
};

const SCOPE_COLORS: Record<ScopeKind, string> = {
  system: 'claudeExplorer.scope.system',
  user: 'claudeExplorer.scope.user',
  plugin: 'claudeExplorer.scope.plugin',
  workspace: 'claudeExplorer.scope.workspace',
};

const GROUP_ICON_COLOR = 'claudeExplorer.groupIcon';

/**
 * What colour a row should carry. `group` tints only a type group's icon; `scope`,
 * `problem` and `muted` tint the label text as well.
 */
export type Tone =
  | { type: 'group' }
  | { type: 'scope'; scope: ScopeKind }
  | { type: 'problem' }
  | { type: 'muted' }
  /** A switchable item that is on: its icon is drawn faint. */
  | { type: 'toggleOn' }
  /** A switchable item that is off: its icon is drawn solid, its label dimmed. */
  | { type: 'toggleOff' }
  | { type: 'plain' };

/** Off means the extension never writes a file: the enable/disable actions disappear. */
export function isEditingAllowed(): boolean {
  return vscode.workspace.getConfiguration('claudeExplorer').get<boolean>('allowEditing', true);
}

export function isColorful(): boolean {
  return vscode.workspace.getConfiguration('claudeExplorer').get<boolean>('colorful', true);
}

function toneColor(tone: Tone): string | undefined {
  switch (tone.type) {
    case 'group':
      return GROUP_ICON_COLOR;
    case 'scope':
      return SCOPE_COLORS[tone.scope];
    case 'problem':
      return 'list.warningForeground';
    case 'muted':
      return 'disabledForeground';
    case 'toggleOn':
      return 'claudeExplorer.toggle.enabled';
    case 'toggleOff':
      return 'claudeExplorer.toggle.disabled';
    case 'plain':
      return undefined;
  }
}

/** A theme icon tinted by tone, or left in the default foreground when colour is off. */
export function toneIcon(name: string, tone: Tone): vscode.ThemeIcon {
  const color = toneColor(tone);
  // Problems, dimmed rows and on/off state carry meaning, so they stay tinted with colour off.
  const always = tone.type === 'problem' || tone.type === 'muted' || tone.type === 'toggleOn' || tone.type === 'toggleOff';
  return color && (always || isColorful())
    ? new vscode.ThemeIcon(name, new vscode.ThemeColor(color))
    : new vscode.ThemeIcon(name);
}

/**
 * The URI that carries a row's text colour, or undefined when the tone leaves the text
 * alone. It deliberately uses its own scheme: tinting the real file URI would recolour the
 * same files in VS Code's main Explorer too.
 */
export function toneUri(tone: Tone): vscode.Uri | undefined {
  const key =
    tone.type === 'scope'
      ? `scope/${tone.scope}`
      : tone.type === 'problem' || tone.type === 'muted'
        ? tone.type
        : tone.type === 'toggleOff'
          ? 'muted'
          : undefined;
  return key ? vscode.Uri.from({ scheme: DECORATION_SCHEME, path: `/${key}` }) : undefined;
}

export class ToneDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  /** Re-ask for every decoration, after the colour setting changes. */
  refresh(): void {
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== DECORATION_SCHEME || !isColorful()) {
      return undefined;
    }
    const [type, value] = uri.path.slice(1).split('/');
    let color: string | undefined;
    if (type === 'scope') {
      color = SCOPE_COLORS[value as ScopeKind];
    } else if (type === 'problem' || type === 'muted') {
      color = toneColor({ type });
    }
    return color ? { color: new vscode.ThemeColor(color), propagate: false } : undefined;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
