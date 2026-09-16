import * as path from 'path';
import { filesWithExtension, isDir, isFile, readText, subdirs } from '../util/fs';
import { asText, firstMeaningfulLine, parseFrontmatter, toolList } from './frontmatter';
import { Asset, Scope } from './types';

/**
 * Skills, slash commands and subagents are all "a markdown file with optional
 * frontmatter", so they share one reader. What differs is the layout and what the
 * frontmatter is allowed to say.
 */

/** Skills: one directory per skill, entry point always SKILL.md. */
export function discoverSkills(dir: string, scope: Scope): Asset[] {
  if (!isDir(dir)) {
    return [];
  }
  const out: Asset[] = [];
  for (const name of subdirs(dir)) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!isFile(file)) {
      continue;
    }
    const { data, body } = parseFrontmatter(readText(file) ?? '');
    const skillName = asText(data.name) ?? name;
    const detail: Record<string, string> = {};
    const tools = toolList(data.tools);
    if (tools.length > 0) {
      detail['Tools'] = tools.join(', ');
    }
    for (const key of ['version', 'context', 'compatibility']) {
      const value = asText(data[key]);
      if (value) {
        detail[key[0].toUpperCase() + key.slice(1)] = value;
      }
    }
    const extras = bundledFiles(path.join(dir, name));
    if (extras > 0) {
      detail['Bundled files'] = `${extras} beside SKILL.md`;
    }

    out.push({
      kind: 'skill',
      name: skillName,
      description: asText(data.description) ?? firstMeaningfulLine(body),
      scope,
      sourcePath: file,
      detail,
      invocation: scope.kind === 'plugin' ? `/${scope.label}:${skillName}` : `/${skillName}`,
      // Only flag a skill with no description ANYWHERE. Falling back to the body is
      // supported two lines above, so flagging the frontmatter alone contradicted it.
      problem:
        asText(data.description) ?? firstMeaningfulLine(body)
          ? undefined
          : 'No description — Claude cannot know when to use this skill.',
    });
  }
  return out;
}

function bundledFiles(skillDir: string): number {
  const others = filesWithExtension(skillDir, '').filter((f) => path.basename(f) !== 'SKILL.md');
  return others.length + subdirs(skillDir).length;
}

/**
 * Slash commands: flat `.md` files, name taken from the filename.
 *
 * The user's own `doc.md` and `pr.md` have NO frontmatter at all -- their first line is
 * the description. Plugin commands do have frontmatter, with `description`,
 * `argument-hint` and `allowed-tools`.
 */
export function discoverCommands(dir: string, scope: Scope): Asset[] {
  if (!isDir(dir)) {
    return [];
  }
  const out: Asset[] = [];
  for (const file of filesWithExtension(dir, '.md')) {
    const name = path.basename(file, '.md');
    const { data, body, hasFrontmatter } = parseFrontmatter(readText(file) ?? '');
    const detail: Record<string, string> = {};
    const tools = toolList(data['allowed-tools']);
    if (tools.length > 0) {
      detail['Allowed tools'] = tools.join(', ');
    }
    const hint = asText(data['argument-hint']);
    if (hint) {
      detail['Arguments'] = hint;
    }
    if (!hasFrontmatter) {
      detail['Frontmatter'] = 'none (description taken from the first line)';
    }

    out.push({
      kind: 'command',
      name,
      description: asText(data.description) ?? firstMeaningfulLine(body),
      scope,
      sourcePath: file,
      detail,
      invocation: scope.kind === 'plugin' ? `/${scope.label}:${name}` : `/${name}`,
    });
  }
  return out;
}

/**
 * Subagents: flat `.md` files with `name` / `description` / `model` / `color` / `tools`.
 *
 * `description` is often a YAML block scalar running 30+ lines with embedded <example>
 * blocks -- see frontmatter.ts. Plugins also nest agents INSIDE a skill directory
 * (skill-creator does), which `discoverNestedAgents` picks up.
 */
export function discoverAgents(dir: string, scope: Scope): Asset[] {
  if (!isDir(dir)) {
    return [];
  }
  const out: Asset[] = [];
  for (const file of filesWithExtension(dir, '.md')) {
    const { data, body } = parseFrontmatter(readText(file) ?? '');
    const name = asText(data.name) ?? path.basename(file, '.md');
    const detail: Record<string, string> = {};
    const tools = toolList(data.tools);
    detail['Tools'] = tools.length > 0 ? tools.join(', ') : 'inherits all tools';
    const model = asText(data.model);
    if (model) {
      detail['Model'] = model;
    }

    out.push({
      kind: 'agent',
      name,
      description: firstSentence(asText(data.description) ?? firstMeaningfulLine(body)),
      scope,
      sourcePath: file,
      detail,
    });
  }
  return out;
}

/** Agents living under `<plugin>/skills/<skill>/agents/`, which a flat scan misses. */
export function discoverNestedAgents(pluginRoot: string, scope: Scope): Asset[] {
  const skillsDir = path.join(pluginRoot, 'skills');
  if (!isDir(skillsDir)) {
    return [];
  }
  const out: Asset[] = [];
  for (const skill of subdirs(skillsDir)) {
    out.push(...discoverAgents(path.join(skillsDir, skill, 'agents'), scope));
  }
  return out;
}

/** Block-scalar descriptions are long; the tree wants one line. */
function firstSentence(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/\.\s|\.$/);
  const first = stop === -1 ? flat : flat.slice(0, stop + 1);
  return first.length > 200 ? `${first.slice(0, 197)}…` : first;
}
