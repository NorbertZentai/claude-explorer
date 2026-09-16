import * as path from 'path';
import { Asset } from '../discovery/types';
import { readServer } from '../mcp/definition';
import { findLine, readText } from '../util/fs';
import { EffectiveEntry, EffectiveSettings } from './effectiveSettings';

/**
 * A security review of what a Claude Code session in one project is allowed to do,
 * built from the merged settings and the discovered assets. Rules of thumb from
 * code.claude.com/docs/en/permissions:
 *
 *   - rules are checked deny, then ask, then allow; the first match decides
 *   - `Bash` and `Bash(*)` are the same rule: every shell command
 *   - `*` in a Bash rule matches everything in its place, including spaces, so a
 *     wildcard before the subcommand (`git * main`) or after a runner (`npx *`) covers
 *     arbitrary commands
 *   - bare `WebFetch` and `WebFetch(domain:*)` allow every host
 *   - `auto` and `bypassPermissions` from project or local settings are ignored
 *
 * Findings are heuristics, never verdicts, and they carry names only: a credential in an
 * MCP definition is reported by its variable name, never its value.
 */

export type Severity = 'high' | 'medium' | 'info';

export interface SecurityFinding {
  severity: Severity;
  title: string;
  detail: string;
  sourcePath: string;
  line?: number;
  /** The permission rule involved, when there is one. Safe to show: it went through redaction. */
  rule?: string;
}

export interface PermissionRuleRow {
  list: 'deny' | 'ask' | 'allow';
  rule: string;
  sourceLabel: string;
  sourcePath: string;
  line?: number;
  duplicate: boolean;
}

export interface SecurityReport {
  findings: SecurityFinding[];
  rules: PermissionRuleRow[];
  mode?: { value: string; sourceLabel: string; sourcePath: string; line?: number };
}

const RUNNERS = ['npx', 'bunx', 'pnpx', 'pnpm dlx', 'yarn dlx', 'docker exec', 'docker run', 'devbox run', 'mise exec', 'direnv exec', 'uvx', 'sh -c', 'bash -c', 'zsh -c', 'eval', 'xargs', 'sudo', 'env'];
const DESTRUCTIVE = ['rm', 'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'git push', 'git reset', 'git clean'];
const NETWORK = ['curl', 'wget', 'nc', 'ssh', 'scp', 'rsync'];

export function securityReport(assets: readonly Asset[], settings: EffectiveSettings, workspaceRoot: string | undefined): SecurityReport {
  const findings: SecurityFinding[] = [];
  const rules: PermissionRuleRow[] = [];
  const order = { deny: 0, ask: 1, allow: 2 } as const;

  for (const entry of settings.entries) {
    const list = /^permissions\.(allow|ask|deny)$/.exec(entry.keyPath)?.[1] as PermissionRuleRow['list'] | undefined;
    if (!list) {
      continue;
    }
    rules.push({
      list,
      rule: entry.value,
      sourceLabel: entry.source.label,
      sourcePath: entry.source.file,
      line: entry.source.line,
      duplicate: entry.status === 'duplicate',
    });
    if (list === 'allow' && entry.status !== 'duplicate') {
      findings.push(...allowRuleFindings(entry));
    }
  }
  rules.sort((a, b) => order[a.list] - order[b.list]);

  const effective = (key: string): EffectiveEntry | undefined =>
    settings.entries.find((e) => e.keyPath === key && e.status === 'effective');

  // The first defaultMode Claude Code will actually honour: auto and bypassPermissions from
  // project files are skipped, so a lower user value can still apply.
  const modeEntry = settings.entries.find(
    (e) =>
      e.keyPath === 'permissions.defaultMode' &&
      !((e.value === 'auto' || e.value === 'bypassPermissions') && e.source.label.startsWith('project')),
  );
  const mode = modeEntry && {
    value: modeEntry.value,
    sourceLabel: modeEntry.source.label,
    sourcePath: modeEntry.source.file,
    line: modeEntry.source.line,
  };
  for (const entry of settings.entries.filter((e) => e.keyPath === 'permissions.defaultMode')) {
    const fromProject = entry.source.label.startsWith('project');
    if ((entry.value === 'bypassPermissions' || entry.value === 'auto') && fromProject) {
      findings.push({
        severity: 'info',
        title: `defaultMode "${entry.value}" is ignored here`,
        detail: 'Claude Code does not take auto or bypassPermissions from project or local settings. Set it in user settings or pass --permission-mode.',
        ...at(entry),
      });
    } else if (entry.value === 'bypassPermissions' && entry === modeEntry) {
      findings.push({
        severity: 'high',
        title: 'Sessions start in bypassPermissions mode',
        detail: 'Every tool call runs without asking, including writes to .git and .claude. The docs advise this only inside an isolated container or VM.',
        ...at(entry),
      });
    }
  }

  const skipPrompt = effective('skipDangerousModePermissionPrompt');
  if (skipPrompt?.value === 'true') {
    findings.push({
      severity: 'medium',
      title: 'The bypassPermissions warning is switched off',
      detail: 'skipDangerousModePermissionPrompt skips the confirmation before entering bypassPermissions mode.',
      ...at(skipPrompt),
    });
  }

  const approveAll = effective('enableAllProjectMcpServers');
  if (approveAll?.value === 'true') {
    findings.push({
      severity: 'medium',
      title: 'Every project MCP server is approved automatically',
      detail: 'enableAllProjectMcpServers starts any server a repository adds to .mcp.json, without asking. Approve servers by name with enabledMcpjsonServers instead.',
      ...at(approveAll),
    });
  }

  const sandbox = effective('sandbox.enabled');
  if (sandbox?.value !== 'true') {
    findings.push({
      severity: 'info',
      title: 'Bash commands are not sandboxed',
      detail: 'Permission rules match command text, not what a command does: /usr/bin/curl or sh -c slip past a Bash(curl *) deny. sandbox.enabled adds filesystem and network isolation that does not depend on the text.',
      sourcePath: sandbox?.source.file ?? settings.layers.find((l) => l.exists)?.file ?? '',
      line: sandbox?.source.line,
    });
  }

  const denies = rules.filter((r) => r.list === 'deny').map((r) => r.rule);
  if (!denies.some((r) => /^Read\(.*\.env/.test(r))) {
    findings.push({
      severity: 'info',
      title: 'No deny rule protects .env files',
      detail: 'Nothing stops Claude from reading secrets in .env files. A deny rule such as Read(./.env) or Read(**/.env*) keeps them out of the conversation.',
      sourcePath: settings.layers.find((l) => l.exists)?.file ?? '',
    });
  }

  findings.push(...hookFindings(assets, workspaceRoot));
  findings.push(...mcpFindings(assets, workspaceRoot));

  const weight = { high: 0, medium: 1, info: 2 };
  findings.sort((a, b) => weight[a.severity] - weight[b.severity]);
  return { findings: findings.filter((f) => f.sourcePath !== ''), rules, mode };
}

function at(entry: EffectiveEntry): Pick<SecurityFinding, 'sourcePath' | 'line'> {
  return { sourcePath: entry.source.file, line: entry.source.line };
}

/** What one allow rule opens up, if it is broader than it looks. */
export function allowRuleFindings(entry: Pick<EffectiveEntry, 'value' | 'source'>): SecurityFinding[] {
  const rule = entry.value.trim();
  const where = { sourcePath: entry.source.file, line: entry.source.line, rule };
  const match = /^([A-Za-z0-9_*-]+)(?:\((.*)\))?$/.exec(rule);
  if (!match) {
    return [];
  }
  const [, tool, spec] = match;
  const out: SecurityFinding[] = [];

  if (tool === 'Bash' || tool === 'PowerShell') {
    const s = spec?.trim().replace(/:\*$/, ' *');
    if (s === undefined || s === '*' || s === '' || s === ' *') {
      out.push({ severity: 'high', title: `${tool} is allowed without restriction`, detail: `${rule} lets Claude run any shell command without asking, in every project this file applies to.`, ...where });
      return out;
    }
    const prefix = s.split('*')[0].trim();
    const firstWords = prefix.split(/\s+/).filter(Boolean);
    if (s.startsWith('*')) {
      out.push({ severity: 'high', title: 'Wildcard in the program position', detail: `${rule} matches any program, because the * stands in for the command name.`, ...where });
    } else if (firstWords.length === 1 && /^\S+ \* \S/.test(s)) {
      out.push({ severity: 'medium', title: 'Wildcard before the subcommand', detail: `${rule} matches every subcommand of ${firstWords[0]}, including options that run other programs. Put the * after the subcommand.`, ...where });
    }
    const runner = RUNNERS.find((r) => prefix === r || prefix.startsWith(`${r} `));
    if (runner && s.includes('*')) {
      out.push({ severity: 'medium', title: `${runner} runs whatever follows it`, detail: `${rule} approves any command passed through ${runner}, e.g. "${runner} rm -rf .". Allow the specific inner commands instead.`, ...where });
    }
    const destructive = DESTRUCTIVE.find((d) => prefix === d || prefix.startsWith(`${d} `));
    if (destructive && s.includes('*')) {
      out.push({ severity: 'medium', title: `Destructive command allowed: ${destructive}`, detail: `${rule} lets Claude run ${destructive} with any arguments without asking.`, ...where });
    }
    const network = NETWORK.find((n) => prefix === n || prefix.startsWith(`${n} `));
    if (network && s.includes('*')) {
      out.push({ severity: 'medium', title: `Network tool allowed: ${network}`, detail: `${rule} lets Claude reach any host with ${network}. Prefer WebFetch(domain:…) rules and the sandbox network allowlist.`, ...where });
    }
    return out;
  }

  if (tool === 'WebFetch' && (spec === undefined || spec.trim() === 'domain:*')) {
    out.push({ severity: 'medium', title: 'Fetching any web page is allowed', detail: `${rule} lets Claude fetch every URL without asking, which is also a way to send data out.`, ...where });
  }
  if ((tool === 'Read' || tool === 'Edit') && spec !== undefined) {
    const p = spec.trim();
    if (/^\/\/\*\*?(\/\*\*?)?$/.test(p) || /^~\/\*\*?$/.test(p)) {
      out.push({
        severity: tool === 'Edit' ? 'high' : 'medium',
        title: `${tool} allowed across ${p.startsWith('~') ? 'your home directory' : 'the whole filesystem'}`,
        detail: `${rule} covers SSH keys, cloud credentials and other projects, not only this repository.`,
        ...where,
      });
    }
  }
  if (tool === 'Edit' && spec === undefined) {
    out.push({ severity: 'medium', title: 'All file edits are allowed', detail: `${rule} accepts every edit without asking, inside the working directories.`, ...where });
  }
  if (spec === undefined && /\*/.test(tool) && !/^mcp__[^*]+__/.test(tool)) {
    out.push({ severity: 'info', title: 'This allow rule does nothing', detail: `${rule} is an unanchored tool-name glob. Claude Code skips it with a warning; allow globs only work after mcp__<server>__.`, ...where });
  }
  if (/^mcp__/.test(tool) && spec !== undefined) {
    out.push({ severity: 'info', title: 'This MCP rule is skipped', detail: `Claude Code ignores mcp__ rules with parentheses in settings files. Use mcp__server or mcp__server__tool.`, ...where });
  }
  return out;
}

/** Project hooks run for everyone who clones the repository; network calls there deserve a look. */
function hookFindings(assets: readonly Asset[], workspaceRoot: string | undefined): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const hook of assets) {
    if (hook.kind !== 'hook' || !hook.hook || hook.scope.kind !== 'workspace' || hook.scope.root !== workspaceRoot) {
      continue;
    }
    const scriptText = hook.sourcePath.endsWith('.json') ? '' : readText(hook.sourcePath) ?? '';
    const code = `${hook.hook.command}\n${scriptText}`;
    if (/\b(curl|wget)\b|\|\s*(ba|z)?sh\b|\bnc\s/.test(code)) {
      out.push({
        severity: 'medium',
        title: `Hook makes network calls: ${hook.name}`,
        detail: `This ${hook.hook.event} hook calls curl, wget or pipes into a shell. Project hooks run for everyone who trusts this folder, so check where it sends data.`,
        sourcePath: hook.sourcePath,
        line: hook.line,
      });
    }
  }
  return out;
}

/** `.mcp.json` is committed; a literal value under a credential-like key is a leaked secret. */
function mcpFindings(assets: readonly Asset[], workspaceRoot: string | undefined): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const server of assets) {
    if (server.kind !== 'mcp' || server.scope.kind !== 'workspace' || server.scope.root !== workspaceRoot || !server.sourcePath.endsWith('.mcp.json')) {
      continue;
    }
    const definition = readServer(server.sourcePath, server.name);
    if (!definition) {
      continue;
    }
    const text = readText(server.sourcePath);
    const literal = (values: Record<string, string> | undefined): string[] =>
      Object.entries(values ?? {})
        .filter(([key, value]) => typeof value === 'string' && value.trim() !== '' && !value.includes('${') && /key|token|secret|password|auth|credential|pat\b/i.test(key))
        .map(([key]) => key);
    const names = [...literal(definition.env), ...literal(definition.headers)];
    const id = `${server.sourcePath}#${server.name}`;
    if (names.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push({
        severity: 'high',
        title: `Credential written into ${path.basename(server.sourcePath)}: ${server.name}`,
        detail: `${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} a literal value in a file that is usually committed. Use \${VAR} and set the variable outside the repository. (Values are not shown.)`,
        sourcePath: server.sourcePath,
        line: findLine(text, `"${names[0]}"`) ?? server.line,
      });
    }
  }
  return out;
}
