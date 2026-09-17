import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOverrides, winnerBetween } from '../../src/analysis/overrides';
import { Asset } from '../../src/discovery/types';
import { agent, command, pluginScope, skill, systemScope, userScope, workspaceScope } from '../helpers/assets';

/**
 * Name shadowing. The rules differ between skills/commands and subagents, and a session runs
 * in one project, so two projects must never shadow each other.
 */

test('winnerBetween is undefined when the names differ', () => {
  assert.equal(winnerBetween(skill('a'), skill('b')), undefined);
});

test('winnerBetween is undefined for unrelated kinds', () => {
  assert.equal(winnerBetween(skill('x'), agent('x')), undefined);
});

test('winnerBetween is undefined when either side is a plugin skill or command', () => {
  // Plugin skills are namespaced as /plugin:name, so they never collide.
  assert.equal(winnerBetween(skill('x'), skill('x', { scope: pluginScope() })), undefined);
});

test('a skill beats a command of the same name even from a lower scope', () => {
  // The kind is the first element of the rank tuple, so it outranks the scope.
  const projectSkill = skill('deploy', { scope: workspaceScope() });
  const userCommand = command('deploy', { scope: userScope() });
  assert.equal(winnerBetween(projectSkill, userCommand), projectSkill);
});

test('skills resolve system > user > workspace > plugin', () => {
  const sys = skill('x', { scope: systemScope() });
  const user = skill('x', { scope: userScope() });
  const ws = skill('x', { scope: workspaceScope() });
  assert.equal(winnerBetween(sys, user), sys);
  assert.equal(winnerBetween(user, ws), user);
});

test('subagents resolve the other way round: workspace beats user', () => {
  const ws = agent('reviewer', { scope: workspaceScope() });
  const user = agent('reviewer', { scope: userScope() });
  assert.equal(winnerBetween(ws, user), ws);
});

test('winnerBetween is undefined for a tie', () => {
  assert.equal(winnerBetween(skill('x'), skill('x')), undefined);
});

test('applyOverrides marks only the loser, and names the winner', () => {
  const user = skill('deploy', { scope: userScope() });
  const ws = skill('deploy', { scope: workspaceScope() });
  applyOverrides([user, ws], [workspaceScope()]);
  assert.equal(user.overriddenBy, undefined);
  assert.equal(ws.overriddenBy?.name, '/deploy');
  assert.equal(ws.overriddenBy?.scopeLabel, 'user');
  assert.equal(ws.overriddenBy?.sourcePath, user.sourcePath);
});

test('the reason wording differs for command-vs-skill, agents and same-kind', () => {
  const winnerSkill = skill('x', { scope: userScope() });
  const loserCommand = command('x', { scope: workspaceScope() });
  applyOverrides([winnerSkill, loserCommand], [workspaceScope()]);
  assert.match(loserCommand.overriddenBy?.reason ?? '', /A skill with the same name takes precedence/);

  const winnerAgent = agent('a', { scope: workspaceScope() });
  const loserAgent = agent('a', { scope: userScope() });
  applyOverrides([winnerAgent, loserAgent], [workspaceScope()]);
  assert.match(loserAgent.overriddenBy?.reason ?? '', /Subagents resolve managed > project > user > plugin/);
});

test('placeholders never take part', () => {
  const real = skill('x', { scope: userScope() });
  const ghost = skill('x', { scope: workspaceScope(), placeholder: true });
  applyOverrides([real, ghost], [workspaceScope()]);
  assert.equal(ghost.overriddenBy, undefined);
});

test('a disabled plugin cannot shadow anything', () => {
  const plugin = pluginScope();
  const pluginAgent = agent('reviewer', { scope: plugin });
  const userAgent = agent('reviewer', { scope: userScope() });
  const pluginRow: Asset = {
    kind: 'plugin',
    name: 'myplugin',
    scope: plugin,
    sourcePath: `${plugin.root}/plugin.json`,
    enabled: false,
  };
  applyOverrides([pluginRow, pluginAgent, userAgent], [workspaceScope()]);
  // The user agent outranks a plugin one anyway; what matters is the plugin asset is not
  // considered part of the session at all, so it is not marked as a loser either.
  assert.equal(pluginAgent.overriddenBy, undefined);
});

test('two workspaces never shadow each other', () => {
  const one = workspaceScope('/p1', 'project1');
  const two = workspaceScope('/p2', 'project2');
  const a = skill('x', { scope: one });
  const b = skill('x', { scope: two });
  applyOverrides([a, b], [one, two]);
  assert.equal(a.overriddenBy, undefined);
  assert.equal(b.overriddenBy, undefined);
});

test('a user skill shadowed in one of two projects is partial, and says where', () => {
  const one = workspaceScope('/p1', 'project1');
  const two = workspaceScope('/p2', 'project2');
  const user = command('deploy', { scope: userScope() });
  const winner = skill('deploy', { scope: two });
  applyOverrides([user, winner], [one, two]);
  assert.equal(user.overriddenBy?.everywhere, false);
  assert.deepEqual(user.overriddenBy?.inRoots, ['/p2']);
  assert.match(user.overriddenBy?.reason ?? '', / in project2\.$/);
});

test('a user skill shadowed in every project is everywhere, with no "in …" suffix', () => {
  const one = workspaceScope('/p1', 'project1');
  const two = workspaceScope('/p2', 'project2');
  const user = command('deploy', { scope: userScope() });
  applyOverrides([user, skill('deploy', { scope: one }), skill('deploy', { scope: two })], [one, two]);
  assert.equal(user.overriddenBy?.everywhere, true);
  assert.equal(user.overriddenBy?.inRoots, undefined);
  assert.ok(!(user.overriddenBy?.reason ?? '').includes(' in project'));
});

test('a workspace loser is always everywhere, because it exists in one session only', () => {
  const ws = workspaceScope();
  const loser = skill('x', { scope: ws });
  applyOverrides([skill('x', { scope: userScope() }), loser], [ws]);
  assert.equal(loser.overriddenBy?.everywhere, true);
});

test('with no project open the single session is labelled user', () => {
  const user = command('deploy', { scope: userScope() });
  applyOverrides([user, skill('deploy', { scope: userScope() })], []);
  assert.equal(user.overriddenBy?.everywhere, true);
});

test('a tie leaves both unmarked', () => {
  const a = skill('x', { scope: userScope() });
  const b = skill('x', { scope: userScope(), sourcePath: '/home/u/.claude/skills/x2/SKILL.md' });
  applyOverrides([a, b], []);
  assert.equal(a.overriddenBy, undefined);
  assert.equal(b.overriddenBy, undefined);
});
