import { Asset, AssetKind, Scope } from '../../src/discovery/types';

/**
 * Literal builders, so a case reads as data rather than setup. Most analysis functions take
 * `Asset[]` directly and never touch the filesystem, which is what makes them unit-testable.
 */

export function userScope(root = '/home/u/.claude'): Scope {
  return { kind: 'user', label: 'user', root };
}

export function workspaceScope(root = '/proj', label = 'proj'): Scope {
  return { kind: 'workspace', label, root, hasConfigDir: true };
}

export function pluginScope(label = 'myplugin', root = '/home/u/.claude/plugins/myplugin'): Scope {
  return { kind: 'plugin', label, root };
}

export function systemScope(root = '/etc/claude-code'): Scope {
  return { kind: 'system', label: 'system', root };
}

export function asset(over: Partial<Asset> & { kind: AssetKind; name: string }): Asset {
  return {
    scope: userScope(),
    sourcePath: `/home/u/.claude/${over.kind}s/${over.name}`,
    ...over,
  };
}

/** A skill as discovery would build it, invocation included. */
export function skill(name: string, over: Partial<Asset> = {}): Asset {
  const scope = over.scope ?? userScope();
  return asset({
    kind: 'skill',
    name,
    description: `Does ${name}.`,
    invocation: scope.kind === 'plugin' ? `/${scope.label}:${name}` : `/${name}`,
    sourcePath: `${scope.root}/skills/${name}/SKILL.md`,
    ...over,
    scope,
  });
}

export function command(name: string, over: Partial<Asset> = {}): Asset {
  const scope = over.scope ?? userScope();
  return asset({
    kind: 'command',
    name,
    description: `Runs ${name}.`,
    invocation: scope.kind === 'plugin' ? `/${scope.label}:${name}` : `/${name}`,
    sourcePath: `${scope.root}/commands/${name}.md`,
    ...over,
    scope,
  });
}

/** Subagents deliberately have no invocation -- that is what makes them `mentionable`. */
export function agent(name: string, over: Partial<Asset> = {}): Asset {
  const scope = over.scope ?? userScope();
  return asset({
    kind: 'agent',
    name,
    description: `Use the ${name} agent when …`,
    sourcePath: `${scope.root}/agents/${name}.md`,
    ...over,
    scope,
  });
}
