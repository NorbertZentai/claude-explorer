import { Asset, Scope } from '../discovery/types';

/**
 * Which assets never run because another one with the same name wins.
 *
 * Claude Code resolves names per session, and a session runs in one project: the system,
 * user and enabled plugin assets plus that one project's. So every workspace scope is
 * checked as its own session, and two projects never shadow each other. Rules, from
 * code.claude.com/docs:
 *
 *   skills & commands   a skill beats a command of the same name;
 *                       otherwise enterprise > personal (user) > project.
 *                       Plugin skills and commands are namespaced and never collide.
 *   subagents           managed > project > user > plugin.
 *
 * Mutates the assets in place by setting `overriddenBy`, like the mtime pass in collect().
 */
export function applyOverrides(assets: Asset[], scopes: readonly Scope[]): void {
  const real = assets.filter((a) => !a.placeholder);
  const disabledPlugins = new Set(
    real.filter((a) => a.kind === 'plugin' && a.enabled === false).map((a) => a.scope.root),
  );
  const workspaces = scopes.filter((s) => s.kind === 'workspace');
  // With no project open, the only session is the user's own.
  const sessions: Array<Scope | undefined> = workspaces.length > 0 ? workspaces : [undefined];

  const losses = new Map<Asset, Array<{ winner: Asset; session: Scope | undefined }>>();

  for (const session of sessions) {
    const inSession = real.filter((a) => {
      switch (a.scope.kind) {
        case 'system':
        case 'user':
          return true;
        case 'plugin':
          return !disabledPlugins.has(a.scope.root);
        case 'workspace':
          return session !== undefined && a.scope.root === session.root;
      }
    });

    const skillish = inSession.filter(
      (a) => (a.kind === 'skill' || a.kind === 'command') && a.scope.kind !== 'plugin',
    );
    resolve(skillish, (a) => [a.kind === 'skill' ? 0 : 1, SKILL_RANK[a.scope.kind]], session, losses);

    const agents = inSession.filter((a) => a.kind === 'agent');
    resolve(agents, (a) => [AGENT_RANK[a.scope.kind]], session, losses);
  }

  for (const [loser, lost] of losses) {
    const winner = lost[0].winner;
    const everywhere = loser.scope.kind === 'workspace' || lost.length === sessions.length;
    const where = everywhere
      ? ''
      : ` in ${lost.map((l) => l.session?.label ?? 'user').join(', ')}`;
    loser.overriddenBy = {
      name: winner.invocation ?? winner.name,
      scopeLabel: winner.scope.label,
      sourcePath: winner.sourcePath,
      reason: `${reasonFor(loser, winner)}${where}.`,
      everywhere,
      inRoots: everywhere ? undefined : lost.flatMap((l) => (l.session ? [l.session.root] : [])),
    };
  }
}

const SKILL_RANK: Record<Scope['kind'], number> = { system: 0, user: 1, workspace: 2, plugin: 3 };
const AGENT_RANK: Record<Scope['kind'], number> = { system: 0, workspace: 1, user: 2, plugin: 3 };

function resolve(
  candidates: readonly Asset[],
  rank: (a: Asset) => number[],
  session: Scope | undefined,
  losses: Map<Asset, Array<{ winner: Asset; session: Scope | undefined }>>,
): void {
  const byName = new Map<string, Asset[]>();
  for (const asset of candidates) {
    const list = byName.get(asset.name) ?? [];
    list.push(asset);
    byName.set(asset.name, list);
  }
  for (const group of byName.values()) {
    if (group.length < 2) {
      continue;
    }
    const sorted = group.slice().sort((a, b) => compare(rank(a), rank(b)));
    const winner = sorted[0];
    for (const other of sorted.slice(1)) {
      // A tie means two definitions at the same level; the docs do not say which wins,
      // so claiming one is shadowed would be a guess.
      if (compare(rank(other), rank(winner)) === 0) {
        continue;
      }
      const list = losses.get(other) ?? [];
      list.push({ winner, session });
      losses.set(other, list);
    }
  }
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

function reasonFor(loser: Asset, winner: Asset): string {
  if (loser.kind === 'command' && winner.kind === 'skill') {
    return 'A skill with the same name takes precedence over a command';
  }
  if (loser.kind === 'agent') {
    return `Subagents resolve managed > project > user > plugin; the ${winner.scope.kind} one wins`;
  }
  return `Same name resolves enterprise > user > project; the ${winner.scope.kind} one wins`;
}

/**
 * Which of two same-named assets wins when they share a session, by the same rules as
 * `applyOverrides`; undefined when they never collide or tie. Used to warn before a copy
 * creates a new collision.
 */
export function winnerBetween(a: Asset, b: Asset): Asset | undefined {
  const family = (x: Asset): 'skill' | 'agent' | undefined =>
    x.kind === 'agent'
      ? 'agent'
      : (x.kind === 'skill' || x.kind === 'command') && x.scope.kind !== 'plugin'
        ? 'skill'
        : undefined;
  if (a.name !== b.name || family(a) === undefined || family(a) !== family(b)) {
    return undefined;
  }
  const rank = (x: Asset): number[] =>
    family(x) === 'agent' ? [AGENT_RANK[x.scope.kind]] : [x.kind === 'skill' ? 0 : 1, SKILL_RANK[x.scope.kind]];
  const order = compare(rank(a), rank(b));
  return order < 0 ? a : order > 0 ? b : undefined;
}
