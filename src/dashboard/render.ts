import { BudgetReport } from '../analysis/contextBudget';
import { CostEstimate, formatUsd, PRICES_AS_OF } from '../analysis/cost';
import { Suggestion } from '../analysis/optimizer';
import { assetKey, RecentDay } from '../analysis/recent';
import { SecurityReport } from '../analysis/security';
import { EffectiveSettings } from '../analysis/effectiveSettings';
import { TimelineEvent, TOOL_EVENTS } from '../analysis/hookTimeline';
import { Asset, ASSET_LABELS, ASSET_ORDER, Scope, ScopeKind } from '../discovery/types';

/**
 * The dashboard's HTML, built as a string with no `vscode` import so the rendering stays
 * plain and testable. Every piece of configuration text goes through `esc`; the page's
 * script only posts messages back, it never builds markup from data.
 */

export type SectionId = 'summary' | 'problems' | 'overrides' | 'budget' | 'security' | 'settings' | 'hooks' | 'recent';

export interface DashboardModel {
  assets: readonly Asset[];
  /** Workspace scopes the selector offers, plus "user only" when undefined. */
  projects: readonly Scope[];
  selectedRoot: string | undefined;
  budget: BudgetReport;
  settings: EffectiveSettings;
  timeline: TimelineEvent[];
  security: SecurityReport;
  cost: CostEstimate;
  recent: RecentDay[];
  /** `assetKey`s of items that appeared after this VS Code window started. */
  newKeys: ReadonlySet<string>;
  /** claudeExplorer.allowEditing: offer the hook editor. */
  editable: boolean;
  suggestions: Suggestion[];
  /** Undefined when transcript reading is off. */
  usage?: { filesRead: number; days: number };
}

export function renderBody(model: DashboardModel): string {
  const real = model.assets.filter((a) => !a.placeholder);
  const problems = real.filter((a) => a.problem);
  const overridden = real.filter((a) => a.overriddenBy);
  const serious = model.security.findings.filter((f) => f.severity !== 'info').length;

  return `
<header class="top">
  <h1>Explorer for Claude Code</h1>
  <label class="picker">Project
    <select id="project">
      ${model.projects.map((p) => option(p.root, p.label, p.root === model.selectedRoot)).join('')}
      ${option('', 'User only (no project)', model.selectedRoot === undefined)}
    </select>
  </label>
</header>
<nav class="tabs">
  ${nav('summary', 'Overview')}${nav('problems', `Problems (${problems.length})`)}${nav('overrides', `Overrides (${overridden.length})`)}${nav('budget', 'Context budget')}${nav('security', `Security (${serious})`)}${nav('settings', 'Effective settings')}${nav('hooks', 'Hook timeline')}${nav('recent', 'Recent changes')}
</nav>
${summary(real, problems.length, overridden.length, model.budget.totalTokens, serious, model.cost)}
${problemList(problems)}
${overrideList(overridden)}
${budget(model.budget, model.cost, model.suggestions, model.usage, model.editable)}
${security(model.security)}
${settings(model.settings)}
${hooks(model.timeline, model.editable, model.selectedRoot !== undefined)}
${recent(model.recent, model.newKeys)}
`;
}

function summary(real: readonly Asset[], problems: number, overrides: number, tokens: number, serious: number, cost: CostEstimate): string {
  const scopes: ScopeKind[] = ['system', 'user', 'plugin', 'workspace'];
  const kinds = ASSET_ORDER.filter((k) => real.some((a) => a.kind === k));
  const cards = [
    card('Items', String(real.length)),
    card('Problems', String(problems), problems > 0 ? 'warn' : ''),
    card('Overridden', String(overrides)),
    card('Startup context', `≈ ${tokens.toLocaleString('en-US')}`, '', `tokens · ≈ ${formatUsd(cost.firstRequest)} first request`),
    card('Security findings', String(serious), serious > 0 ? 'warn' : '', 'high or medium'),
  ].join('');
  const rows = kinds
    .map(
      (k) =>
        `<tr><th>${esc(ASSET_LABELS[k])}</th>${scopes
          .map((s) => {
            const n = real.filter((a) => a.kind === k && a.scope.kind === s).length;
            return `<td class="num${n === 0 ? ' zero' : ''}">${n}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return section(
    'summary',
    'Overview',
    `<div class="cards">${cards}</div>
     <table class="grid"><thead><tr><th></th>${scopes.map((s) => `<th class="num"><span class="scope ${s}">${s}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function problemList(problems: readonly Asset[]): string {
  const body =
    problems.length === 0
      ? empty('No problems found.')
      : `<ul class="list">${problems
          .map(
            (a) => `<li${keys(a.sourcePath)}>${link(a.sourcePath, a.line, a.name)} ${scopeChip(a.scope)} <span class="muted">${esc(ASSET_LABELS[a.kind])}</span>
            <div class="warn-text">${esc(a.problem ?? '')}</div></li>`,
          )
          .join('')}</ul>`;
  return section('problems', 'Problems', body);
}

function overrideList(overridden: readonly Asset[]): string {
  const body =
    overridden.length === 0
      ? empty('Nothing is shadowed: every skill, command and subagent name is unique where it runs.')
      : `<ul class="list">${overridden
          .map((a) => {
            const o = a.overriddenBy!;
            return `<li${keys(a.sourcePath)}>${link(a.sourcePath, undefined, a.invocation ?? a.name)} ${scopeChip(a.scope)}
              <span class="arrow">→ loses to</span> ${link(o.sourcePath, undefined, o.name)} <span class="muted">${esc(o.scopeLabel)}</span>
              ${o.everywhere ? '' : '<span class="tag">partial</span>'}
              <div class="muted">${esc(o.reason)}</div></li>`;
          })
          .join('')}</ul>`;
  return section('overrides', 'Overrides', body);
}

function suggestionList(suggestions: readonly Suggestion[], cost: CostEstimate, usage: DashboardModel['usage'], editable: boolean): string {
  const usageNote = usage
    ? `Usage counted from ${usage.filesRead} local transcript${usage.filesRead === 1 ? '' : 's'} of the last ${usage.days} days (names and dates only).`
    : 'Turn on claudeExplorer.readTranscriptsForUsage to also flag skills you have not used lately. It reads local transcripts on this machine only.';
  const perToken = cost.tokens > 0 ? cost.firstRequest / cost.tokens : 0;
  const items = suggestions
    .map((sug, i) => {
      const needsEdit = sug.action.type !== 'prompt';
      const button = needsEdit && !editable ? '' : `<button class="button small" data-action="applySuggestion" data-key-value="${i}">${esc(sug.actionLabel)}</button>`;
      const saving = sug.saving > 0 ? ` <span class="tag">≈ −${sug.saving.toLocaleString('en-US')} tokens${perToken > 0 ? ` · ${esc(formatUsd(sug.saving * perToken))}/session` : ''}</span>` : '';
      return `<li${keys(sug.sourcePath)}><strong>${esc(sug.title)}</strong>${saving} ${button}
        <div class="muted">${esc(sug.detail)} ${link(sug.sourcePath, undefined, 'Open')}</div></li>`;
    })
    .join('');
  return `<h3>Suggestions</h3>
    ${suggestions.length === 0 ? empty('No suggestions: nothing stands out as oversized or unused.') : `<ul class="list">${items}</ul>`}
    <p class="muted">${esc(usageNote)}</p>`;
}

function budget(report: BudgetReport, cost: CostEstimate, suggestions: readonly Suggestion[], usage: DashboardModel['usage'], editable: boolean): string {
  const max = Math.max(1, ...report.rows.map((r) => r.tokens));
  const rows = report.rows
    .map(
      (r) => `<tr${keys(r.sourcePath)}>
        <td>${link(r.sourcePath, undefined, r.name)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}
          ${r.warning ? `<div class="warn-text">${esc(r.warning)}</div>` : ''}</td>
        <td class="muted">${esc(r.category)}</td>
        <td class="muted">${esc(r.scopeLabel)}</td>
        <td class="num">${r.tokens.toLocaleString('en-US')}</td>
        <td class="bar-cell"><div class="bar" data-width="${Math.max(1, Math.round((r.tokens / max) * 100))}"></div></td>
      </tr>`,
    )
    .join('');
  const body = `
    <p class="lede">About <strong>${report.totalTokens.toLocaleString('en-US')}</strong> tokens of configuration load before your first prompt.
      <span class="muted">Estimate: characters ÷ 4.</span></p>
    <p class="muted">At ${esc(cost.model.label)} API prices (${esc(cost.basis)}; list prices as of ${PRICES_AS_OF}): ≈ <strong>${esc(formatUsd(cost.firstRequest))}</strong> on the first request, which writes the cache, ≈ ${esc(formatUsd(cost.cachedRequest))} on each later request that reads it, ${esc(formatUsd(cost.uncached))} without caching. Subscriptions are not billed per token; Claude 4.7 and later models count roughly 30% more tokens than this estimate.</p>
    ${report.rows.length === 0 ? empty('Nothing measurable loads at startup.') : `<table class="grid"><thead><tr><th>Item</th><th>Type</th><th>Scope</th><th class="num">Tokens</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
    <p class="muted">Not measured: ${esc(report.unmeasured.join('; '))}.</p>
    ${suggestionList(suggestions, cost, usage, editable)}`;
  return section('budget', 'Context budget', body);
}

function security(report: SecurityReport): string {
  const findings =
    report.findings.length === 0
      ? empty('Nothing stands out in the permissions, hooks or MCP definitions of this project.')
      : `<ul class="list">${report.findings
          .map(
            (f) => `<li${keys(`finding:${f.sourcePath}`)}><span class="tag sev-${f.severity}">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong>
              ${link(f.sourcePath, f.line, f.rule ?? shortName(f.sourcePath))}
              <div class="muted">${esc(f.detail)}</div></li>`,
          )
          .join('')}</ul>`;
  const rules =
    report.rules.length === 0
      ? empty('No permission rules in any settings file. Claude asks before every non-read-only action.')
      : `<table class="grid"><thead><tr><th>List</th><th>Rule</th><th>From</th></tr></thead><tbody>${report.rules
          .map(
            (r) => `<tr class="${r.duplicate ? 'status-duplicate' : ''}"${keys(`rule:${r.rule}`)}><td><span class="tag list-${r.list}">${r.list}</span></td>
              <td class="mono">${esc(r.rule)}</td><td>${link(r.sourcePath, r.line, r.sourceLabel)}${r.duplicate ? ' <span class="muted">(duplicate)</span>' : ''}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  const mode = report.mode
    ? `Sessions start in <span class="mono">${esc(report.mode.value)}</span> mode (${link(report.mode.sourcePath, report.mode.line, report.mode.sourceLabel)}).`
    : 'No settings file sets permissions.defaultMode, so sessions start in the default (Manual) mode.';
  const body = `
    <p class="lede">${mode} <span class="muted">Heuristics, not a verdict.</span></p>
    <div class="actions"><button class="button" data-action="copyPrompt" data-prompt="securityHardening">Copy hardening prompt</button></div>
    ${findings}
    <h3>Test a tool call</h3>
    <p class="muted">Which rule decides a call? Checked deny → ask → allow, first match wins. An approximation of Claude Code's matcher.</p>
    <div class="tester"><input id="perm-input" class="input mono" type="text" placeholder="Bash(npm test)   Read(src/index.ts)   WebFetch(https://example.com)" spellcheck="false">
    <button class="button" id="perm-test">Test</button></div>
    <div id="perm-result" class="tester-result" aria-live="polite"></div>
    <h3>Permission rules</h3>
    ${rules}`;
  return section('security', 'Security', body);
}

function recent(days: readonly RecentDay[], newKeys: ReadonlySet<string>): string {
  const body =
    days.length === 0
      ? empty('Nothing changed in the last 14 days.')
      : days
          .map(
            (d) => `<h3>${esc(d.day)}</h3><ul class="list">${d.assets
              .map(
                (a) => `<li${keys(a.sourcePath)}>${link(a.sourcePath, a.line, a.invocation ?? a.name)} ${scopeChip(a.scope)} <span class="muted">${esc(ASSET_LABELS[a.kind])} · ${esc(timeOf(a.modified!))}</span>${newKeys.has(assetKey(a)) ? ' <span class="tag">new this session</span>' : ''}</li>`,
              )
              .join('')}</ul>`,
          )
          .join('');
  return section('recent', 'Recent changes', `<p class="muted">Configuration files modified in the last 14 days, newest first. Plans are left out.</p>${body}`);
}

function timeOf(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shortName(file: string): string {
  return file.split(/[\\/]/).slice(-2).join('/');
}

function settings(model: EffectiveSettings): string {
  const layers = model.layers
    .map((l) => `<li class="${l.exists ? '' : 'absent'}">${l.exists ? link(l.file, undefined, l.label) : esc(l.label)}${l.valid ? '' : ' <span class="warn-text">invalid JSON</span>'}</li>`)
    .join('');
  const rows = model.entries
    .map(
      (e) => `<tr class="status-${e.status}"${keys(`setting:${e.keyPath}`, `source:${e.source.file}`)}>
        <td class="mono">${esc(e.keyPath)}</td>
        <td class="mono value">${esc(e.value)}</td>
        <td>${link(e.source.file, e.source.line, e.source.label)}</td>
        <td><span class="tag ${e.status}">${e.status}</span>${e.note ? `<div class="muted">${esc(e.note)}</div>` : ''}</td>
      </tr>`,
    )
    .join('');
  const body = `
    <p class="muted">Highest precedence first. Lists merge across files; any other value comes from the highest file that sets it.</p>
    <ol class="layers">${layers}</ol>
    ${model.entries.length === 0 ? empty('No settings in any file.') : `<table class="grid"><thead><tr><th>Key</th><th>Value</th><th>From</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`}
    ${model.notes.map((n) => `<p class="muted">${esc(n)}</p>`).join('')}`;
  return section('settings', 'Effective settings', body);
}

function hooks(timeline: readonly TimelineEvent[], editable: boolean, hasProject: boolean): string {
  const canEdit = editable && timeline.some((ev) => ev.hooks.some((h) => h.editable));
  const layers = canEdit
    ? `<div class="drop-layers"><span class="muted">Drag a hook onto another event to move it there, or onto a file to move it into that settings file:</span>
        <span class="drop-target layer" data-layer="user">user settings.json</span>${
          hasProject
            ? '<span class="drop-target layer" data-layer="project">project .claude/settings.json</span><span class="drop-target layer" data-layer="local">project .claude/settings.local.json</span>'
            : ''
        }</div>`
    : '';
  const tester = `<div class="tester"><input id="matcher-input" class="input mono" type="text" placeholder="Which hooks fire for a tool? e.g. Bash, Edit, mcp__github__create_issue" spellcheck="false"></div>
    <div id="matcher-result" class="tester-result muted" aria-live="polite"></div>`;
  const body =
    timeline.length === 0
      ? empty('No hooks run in this project.')
      : `<p class="muted">Every matching hook for an event runs in parallel, so the order within an event does not matter. The same handler in several settings files runs once.</p>
         ${tester}
         ${layers}
         <ol class="timeline">${timeline
           .map(
             (ev, e) => `<li class="event${canEdit ? ' drop-target' : ''}" data-event="${esc(ev.name)}"${TOOL_EVENTS.has(ev.name) ? ' data-tool-event="1"' : ''}>
               <div class="event-head"><span class="event-name">${esc(ev.name)}</span> <span class="muted">${esc(ev.when)}</span>${ev.known ? '' : ' <span class="tag">unknown event</span>'}</div>
               <ul class="list">${ev.hooks
                 .map((h, i) => {
                   const id = `${e}-${i}`;
                   const drag = canEdit && h.editable ? ` draggable="true" data-hook="${id}"` : '';
                   return `<li class="hook ${h.duplicateOf ? 'dup' : ''}${drag ? ' draggable' : ''}"${keys(`hook:${h.sourcePath}`)}${drag} data-matcher="${esc(h.matcher)}" data-matcher-kind="${h.matcherKind}">
                     <span class="tag matcher-${h.matcherKind}" title="${h.matcherKind === 'all' ? 'matches everything' : h.matcherKind === 'exact' ? 'exact name or list' : 'regular expression'}">${esc(h.matcher)}</span>
                     <span class="mono">${esc(h.command)}</span> ${link(h.sourcePath, h.line, h.scopeLabel)}
                     ${canEdit && h.editable ? `<button class="button small" data-action="editHook" data-key-value="${id}" title="Change event, matcher or command, move or delete">Edit…</button>` : ''}
                     ${h.duplicateOf ? `<div class="muted">Runs once: also declared in ${esc(h.duplicateOf)}.</div>` : ''}
                     ${h.problem ? `<div class="warn-text">${esc(h.problem)}</div>` : ''}
                   </li>`;
                 })
                 .join('')}</ul>
             </li>`,
           )
           .join('')}</ol>`;
  return section('hooks', 'Hook timeline', body);
}

// --- small pieces --------------------------------------------------------------------

function section(id: SectionId, title: string, body: string): string {
  return `<section id="${id}"><h2>${esc(title)}</h2>${body}</section>`;
}

function nav(id: SectionId, label: string): string {
  return `<a href="#${id}" data-section="${id}">${esc(label)}</a>`;
}

function card(label: string, value: string, cls = '', sub = ''): string {
  return `<div class="card ${cls}"><div class="card-value">${esc(value)}</div><div class="card-label">${esc(label)}${sub ? ` <span class="muted">${esc(sub)}</span>` : ''}</div></div>`;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

function scopeChip(scope: Scope): string {
  return `<span class="scope ${scope.kind}">${esc(scope.label)}</span>`;
}

function link(file: string, line: number | undefined, label: string): string {
  return `<a href="#" class="open" data-path="${esc(file)}"${line !== undefined ? ` data-line="${line}"` : ''} title="${esc(file)}">${esc(label)}</a>`;
}

/** Identities a reveal can target, matched by prefix. `|` never occurs in the keys used. */
function keys(...values: string[]): string {
  return ` data-key="${esc(values.join('|'))}"`;
}

function empty(text: string): string {
  return `<p class="empty">${esc(text)}</p>`;
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
