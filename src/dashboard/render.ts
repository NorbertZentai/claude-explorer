import { BudgetReport } from '../analysis/contextBudget';
import { EffectiveSettings } from '../analysis/effectiveSettings';
import { TimelineEvent } from '../analysis/hookTimeline';
import { Asset, ASSET_LABELS, ASSET_ORDER, Scope, ScopeKind } from '../discovery/types';

/**
 * The dashboard's HTML, built as a string with no `vscode` import so the rendering stays
 * plain and testable. Every piece of configuration text goes through `esc`; the page's
 * script only posts messages back, it never builds markup from data.
 */

export type SectionId = 'summary' | 'problems' | 'overrides' | 'budget' | 'settings' | 'hooks';

export interface DashboardModel {
  assets: readonly Asset[];
  /** Workspace scopes the selector offers, plus "user only" when undefined. */
  projects: readonly Scope[];
  selectedRoot: string | undefined;
  budget: BudgetReport;
  settings: EffectiveSettings;
  timeline: TimelineEvent[];
}

export function renderBody(model: DashboardModel): string {
  const real = model.assets.filter((a) => !a.placeholder);
  const problems = real.filter((a) => a.problem);
  const overridden = real.filter((a) => a.overriddenBy);

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
  ${nav('summary', 'Overview')}${nav('problems', `Problems (${problems.length})`)}${nav('overrides', `Overrides (${overridden.length})`)}${nav('budget', 'Context budget')}${nav('settings', 'Effective settings')}${nav('hooks', 'Hook timeline')}
</nav>
${summary(real, problems.length, overridden.length, model.budget.totalTokens)}
${problemList(problems)}
${overrideList(overridden)}
${budget(model.budget)}
${settings(model.settings)}
${hooks(model.timeline)}
`;
}

function summary(real: readonly Asset[], problems: number, overrides: number, tokens: number): string {
  const scopes: ScopeKind[] = ['system', 'user', 'plugin', 'workspace'];
  const kinds = ASSET_ORDER.filter((k) => real.some((a) => a.kind === k));
  const cards = [
    card('Items', String(real.length)),
    card('Problems', String(problems), problems > 0 ? 'warn' : ''),
    card('Overridden', String(overrides)),
    card('Startup context', `≈ ${tokens.toLocaleString('en-US')}`, '', 'tokens, estimate'),
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

function budget(report: BudgetReport): string {
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
    ${report.rows.length === 0 ? empty('Nothing measurable loads at startup.') : `<table class="grid"><thead><tr><th>Item</th><th>Type</th><th>Scope</th><th class="num">Tokens</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
    <p class="muted">Not measured: ${esc(report.unmeasured.join('; '))}.</p>`;
  return section('budget', 'Context budget', body);
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

function hooks(timeline: readonly TimelineEvent[]): string {
  const body =
    timeline.length === 0
      ? empty('No hooks run in this project.')
      : `<p class="muted">Every matching hook for an event runs in parallel. The same handler in several settings files runs once.</p>
         <ol class="timeline">${timeline
           .map(
             (ev) => `<li class="event">
               <div class="event-head"><span class="event-name">${esc(ev.name)}</span> <span class="muted">${esc(ev.when)}</span>${ev.known ? '' : ' <span class="tag">unknown event</span>'}</div>
               <ul class="list">${ev.hooks
                 .map(
                   (h) => `<li class="${h.duplicateOf ? 'dup' : ''}"${keys(`hook:${h.sourcePath}`)}>
                     <span class="tag matcher-${h.matcherKind}" title="${h.matcherKind === 'all' ? 'matches everything' : h.matcherKind === 'exact' ? 'exact name or list' : 'regular expression'}">${esc(h.matcher)}</span>
                     <span class="mono">${esc(h.command)}</span> ${link(h.sourcePath, h.line, h.scopeLabel)}
                     ${h.duplicateOf ? `<div class="muted">Runs once: also declared in ${esc(h.duplicateOf)}.</div>` : ''}
                     ${h.problem ? `<div class="warn-text">${esc(h.problem)}</div>` : ''}
                   </li>`,
                 )
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
