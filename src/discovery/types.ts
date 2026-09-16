/** Plain data shared by the discovery layer. Nothing here imports `vscode`. */

export type ScopeKind = 'system' | 'user' | 'workspace' | 'plugin';

export interface Scope {
  kind: ScopeKind;
  /** What shows in the badge: 'user', a workspace/repo name, or a plugin name. */
  label: string;
  /** Base directory this scope was discovered from. */
  root: string;
  /** True when the user attached this folder by hand rather than it being open. */
  attached?: boolean;
  /**
   * False for a folder we recognise as a project (it has .git or a CLAUDE.md) but which
   * has no `.claude/` yet. Worth listing: "this project has no Claude config" is useful
   * information, and an invisible project looks like a discovery bug.
   */
  hasConfigDir?: boolean;
  /**
   * The project the user is actually in (the resolved workspace root, the folder they
   * opened, or one they attached) as opposed to a sibling repo found underneath it.
   * Only these get placeholder rows -- otherwise a workspace of six clones produces
   * eighty greyed rows and buries the real content.
   */
  primary?: boolean;
}

export type AssetKind =
  | 'policy'
  | 'setting'
  | 'skill'
  | 'command'
  | 'agent'
  | 'rule'
  | 'outputStyle'
  | 'theme'
  | 'workflow'
  | 'hook'
  | 'mcp'
  | 'lsp'
  | 'plugin'
  | 'keybinding'
  | 'plan'
  | 'memory';

export interface Asset {
  kind: AssetKind;
  name: string;
  description?: string;
  scope: Scope;
  /** File to open on click. For a placeholder, the directory it would live in. */
  sourcePath: string;
  /** 0-based line to reveal, for assets defined inside a larger file. */
  line?: number;
  /** Extra frontmatter / config worth showing in the tooltip. */
  detail?: Record<string, string>;
  /** Set when something is wrong -- a missing script, a stale reference. */
  problem?: string;
  /** What to type to invoke it, if anything. */
  invocation?: string;
  /** Tri-state: true/false where enablement is a real concept, undefined otherwise. */
  enabled?: boolean;
  /** Last-modified time of sourcePath, epoch ms. Filled centrally in collect(). */
  modified?: number;
  /**
   * A surface Claude Code supports that this scope has nothing for. Rendered greyed, so
   * "I have none of these" stays distinguishable from "the tool never looked here".
   */
  placeholder?: boolean;
  /** Official documentation URL for the surface this asset belongs to. */
  docs?: string;
  /**
   * Set when another asset with the same name wins in a Claude Code session, so this one
   * never runs there. Filled by analysis/overrides.ts; not a problem, just not in effect.
   */
  overriddenBy?: Override;
  /**
   * Where this asset's on/off switch lives, when flipping it is a documented setting.
   * Absent for everything that cannot be toggled from here.
   */
  toggle?: Toggle;
  /** Structured hook declaration, so the timeline does not re-parse `detail` strings. */
  hook?: HookDeclaration;
  /**
   * The `skillOverrides` state that applies to a user or project skill or command, when
   * one is set. Absent means `on`. Filled by discovery/visibility.ts.
   */
  skillOverride?: SkillOverride;
}

export type SkillOverride = 'on' | 'name-only' | 'user-invocable-only' | 'off';

export interface Override {
  /** The winning asset's name and scope, for display. */
  name: string;
  scopeLabel: string;
  sourcePath: string;
  /** One sentence on which documented rule applied, and where. */
  reason: string;
  /**
   * False when this asset loses only in some projects -- a user skill shadowed by one
   * repo's skill of the same name still runs everywhere else.
   */
  everywhere: boolean;
  /** Roots of the projects where it loses, when not everywhere. */
  inRoots?: string[];
}

export interface Toggle {
  /** The settings file that holds the switch. */
  file: string;
  target: 'plugin' | 'mcp' | 'skill' | 'claudeMd';
  /**
   * `name@marketplace` for a plugin; the server name for an MCP server; the skill name
   * for `skillOverrides`; the absolute file path for `claudeMdExcludes`.
   */
  key: string;
}

export interface HookDeclaration {
  event: string;
  /** Undefined when the matcher was omitted, which matches everything. */
  matcher?: string;
  /** As written in the file. Redact before display. */
  command: string;
  /** The settings or hooks.json file that declares it (the asset may point at the script). */
  file: string;
}

export const ASSET_LABELS: Record<AssetKind, string> = {
  policy: 'Policy',
  setting: 'Settings',
  skill: 'Skills',
  command: 'Commands',
  agent: 'Subagents',
  rule: 'Rules',
  outputStyle: 'Output styles',
  theme: 'Themes',
  workflow: 'Workflows',
  hook: 'Hooks',
  mcp: 'MCP servers',
  lsp: 'LSP servers',
  plugin: 'Plugins',
  keybinding: 'Keybindings',
  plan: 'Plans',
  memory: 'Memory',
};

/** Policy and settings first -- they govern everything below them. */
export const ASSET_ORDER: AssetKind[] = [
  'policy',
  'setting',
  'skill',
  'command',
  'agent',
  'rule',
  'hook',
  'mcp',
  'lsp',
  'outputStyle',
  'theme',
  'workflow',
  'keybinding',
  'plugin',
  'plan',
  'memory',
];

export const USER_SCOPE = (root: string): Scope => ({ kind: 'user', label: 'user', root });
