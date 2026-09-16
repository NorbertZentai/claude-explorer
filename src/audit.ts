/**
 * Headless run of the discovery layer: `npm run audit [folder ...]`.
 *
 * This exists because the discovery modules deliberately import no `vscode` API, which
 * makes them runnable in plain Node. It is the fastest way to see what the tree will
 * contain without launching an Extension Development Host, and it doubles as the
 * regression check -- if the counts move, something changed.
 */
import { estimateBudget } from './analysis/contextBudget';
import { effectiveSettings } from './analysis/effectiveSettings';
import { hookTimeline } from './analysis/hookTimeline';
import { renderReport } from './analysis/report';
import { lintSkill } from './analysis/skillLint';
import { promptsFor } from './prompts';
import { collect } from './discovery';
import { GUIDES, renderGuide } from './guides';
import { Asset, ASSET_ORDER, ASSET_LABELS } from './discovery/types';

// `node dist/audit.js <open folder...> --attach <folder...>`
const argv = process.argv.slice(2);
const split = argv.indexOf('--attach');
const folders = (split === -1 ? argv : argv.slice(0, split)).filter((a) => !a.startsWith('--'));
const attached = split === -1 ? [] : argv.slice(split + 1);

const { assets, scopes, note, account } = collect({
  workspaceFolders: folders,
  extraProjectPaths: attached,
  showPluginProvided: true,
  showPlaceholders: true,
});

const pad = (text: string, width: number): string => text.padEnd(width);

console.log(`\nWorkspace folders: ${folders.length > 0 ? folders.join(', ') : '(none open)'}`);
if (note) {
  console.log(`Note: ${note}`);
}

console.log(
  `Claude account: ${account.signedIn ? account.label : 'NOT SIGNED IN'}` +
    (account.organization ? ` (${account.organization})` : ''),
);

console.log('\n--- by type and scope ---');
console.log(
  `${pad('', 14)}${pad('system', 8)}${pad('user', 8)}${pad('plugin', 8)}${pad('workspace', 11)}total`,
);
for (const kind of ASSET_ORDER) {
  const inKind = assets.filter((a) => a.kind === kind);
  if (inKind.length === 0) {
    continue;
  }
  const count = (k: string): number => inKind.filter((a) => a.scope.kind === k).length;
  console.log(
    pad(ASSET_LABELS[kind], 14) +
      pad(String(count('system')), 8) +
      pad(String(count('user')), 8) +
      pad(String(count('plugin')), 8) +
      pad(String(count('workspace')), 11) +
      inKind.length,
  );
}
console.log(`${pad('TOTAL', 14)}${pad('', 35)}${assets.length}`);

const real = assets.filter((a) => !a.placeholder);
const placeholders = assets.filter((a) => a.placeholder);
console.log(`
Real assets: ${real.length}   placeholders: ${placeholders.length}`);
for (const p of placeholders) {
  console.log(`  [${p.scope.label}] ${p.kind}: ${p.description}`);
}

const stamped = real.filter((a) => a.modified !== undefined).length;
console.log(`\nTimestamps resolved: ${stamped}/${assets.length}`);

console.log(`\n--- scopes (${scopes.length}) ---`);
for (const scope of scopes) {
  const mark = scope.attached ? ' [attached]' : '';
  console.log(`  ${pad(scope.kind, 10)} ${pad(scope.label, 24)} ${scope.root}${mark}`);
}

// `--kind skill,setting` prints the individual rows, for spot-checking a reader.
const kindArg = argv.indexOf('--kind');
if (kindArg !== -1) {
  const wanted = new Set((argv[kindArg + 1] ?? '').split(','));
  console.log('\n--- rows ---');
  for (const a of assets.filter((x) => wanted.has(x.kind))) {
    console.log(`  [${a.scope.label}] ${a.name}  ::  ${a.description ?? ''}`);
    for (const [k, v] of Object.entries(a.detail ?? {})) {
      console.log(`        ${k}: ${v}`);
    }
  }
}

// `--guide <kind>` prints one guide; `--guide all` checks every surface has one.
const guideArg = argv.indexOf('--guide');
if (guideArg !== -1) {
  const which = argv[guideArg + 1] ?? 'all';
  if (which === 'all') {
    const kinds = ASSET_ORDER;
    const missing = kinds.filter((k) => !GUIDES[k]);
    console.log(`
Guides: ${kinds.length - missing.length}/${kinds.length} surfaces covered`);
    for (const k of kinds) {
      const g = GUIDES[k];
      console.log(`  ${pad(k, 14)} ${g ? `"${g.title}" · prompt ${g.prompt.length} chars` : 'MISSING'}`);
    }
    if (missing.length > 0) {
      process.exitCode = 1;
    }
  } else {
    console.log('\n' + renderGuide(which as never));
  }
}

const overridden = assets.filter((a) => a.overriddenBy !== undefined);
console.log(`\n--- overrides (${overridden.length}) ---`);
for (const a of overridden) {
  const o = a.overriddenBy!;
  console.log(`  [${a.scope.label}] ${a.kind} "${a.name}" -> ${o.name} [${o.scopeLabel}]${o.everywhere ? '' : ' (partial)'}\n      ${o.reason}`);
}

const sessions = scopes.filter((s) => s.kind === 'workspace');
const settingsRendered: string[] = [];
for (const session of sessions.length > 0 ? sessions : [undefined]) {
  const report = estimateBudget(assets, session?.root);
  console.log(`\n--- context budget: ${session?.label ?? 'user only'} (estimate) ---`);
  console.log(`  total ≈ ${report.totalTokens} tokens across ${report.rows.length} items`);
  for (const row of report.rows.slice(0, 8)) {
    console.log(`  ${pad(String(row.tokens), 7)} ${pad(row.category, 10)} [${row.scopeLabel}] ${row.name}${row.note ? ` (${row.note})` : ''}`);
    if (row.warning) {
      console.log(`          ! ${row.warning}`);
    }
  }
  console.log(`  not measured: ${report.unmeasured.join('; ')}`);

  const settings = effectiveSettings(session?.root);
  settingsRendered.push(...settings.entries.map((e) => `${e.keyPath} ${e.value}`));
  console.log(`\n--- effective settings: ${session?.label ?? 'user only'} ---`);
  console.log(`  layers present: ${settings.layers.filter((l) => l.exists).map((l) => l.label).join(' > ') || '(none)'}`);
  for (const e of settings.entries) {
    console.log(`  ${pad(e.status, 11)} ${e.keyPath} = ${e.value}  [${e.source.label}${e.source.line !== undefined ? `:${e.source.line + 1}` : ''}]`);
  }
  for (const note of settings.notes) {
    console.log(`  note: ${note}`);
  }

  console.log(`\n--- hook timeline: ${session?.label ?? 'user only'} ---`);
  for (const event of hookTimeline(assets, session?.root)) {
    console.log(`  ${event.name}${event.known ? '' : ' (unknown event)'} — ${event.when}`);
    for (const h of event.hooks) {
      settingsRendered.push(h.command);
      const flags = [h.duplicateOf ? `runs once, also in ${h.duplicateOf}` : '', h.problem ?? ''].filter(Boolean).join('; ');
      console.log(`      ${pad(`${h.matcher} (${h.matcherKind})`, 22)} [${h.scopeLabel}] ${h.command}${flags ? `  !! ${flags}` : ''}`);
    }
  }
}

// `--lint` checks every skill against the frontmatter reference.
if (argv.includes('--lint')) {
  const skills = assets.filter((a) => a.kind === 'skill' && !a.placeholder);
  console.log(`\n--- skill lint (${skills.length} skills) ---`);
  for (const skill of skills) {
    const findings = lintSkill(skill.sourcePath);
    if (findings.length > 0) {
      console.log(`  [${skill.scope.label}] ${skill.invocation ?? skill.name}`);
      for (const f of findings) {
        console.log(`      ${pad(f.severity, 8)} ${f.line !== undefined ? `L${f.line + 1} ` : ''}${f.message}`);
      }
    }
  }
}

// `--report <user|system|plugin|path>` prints the Markdown export for that scope.
const reportArg = argv.indexOf('--report');
if (reportArg !== -1) {
  const which = argv[reportArg + 1] ?? 'user';
  const kinds = ['user', 'system', 'plugin', 'workspace'];
  const target = kinds.includes(which)
    ? { kind: which as 'user' }
    : { kind: 'workspace' as const, root: scopes.find((s) => s.kind === 'workspace' && s.root.endsWith(which))?.root };
  const report = renderReport(assets, scopes, target, new Date());
  settingsRendered.push(report);
  console.log(`\n--- report ---\n${report}`);
}

// `--prompts` generates every row's Copy Prompt texts; they join the redaction check.
if (argv.includes('--prompts')) {
  const real = assets.filter((a) => !a.placeholder);
  let count = 0;
  for (const asset of real) {
    for (const prompt of promptsFor(asset, { ref: `@${asset.sourcePath}` })) {
      settingsRendered.push(prompt.text);
      count++;
    }
  }
  console.log(`\n--- prompts ---\n  ${count} prompts generated for ${real.length} items`);
}

const problems: Asset[] = assets.filter((a) => a.problem !== undefined);
console.log(`\n--- problems (${problems.length}) ---`);
for (const p of problems) {
  console.log(`  [${p.scope.label}] ${p.kind} "${p.name}"\n      ${p.problem}`);
}

// The point of util/redact.ts is that no value can reach an Asset. Prove it here rather
// than trusting the call sites: fail loudly if any rendered string looks like a secret.
const SECRET_SHAPED = /(?:sk|pk|ghp|gho|ocr_live|xox[abps])[-_][A-Za-z0-9_-]{12,}/;
const leaked = assets.filter((a) =>
  SECRET_SHAPED.test([a.name, a.description ?? '', ...Object.values(a.detail ?? {})].join(' ')),
);
const leakedSettings = settingsRendered.filter((line) => SECRET_SHAPED.test(line));
console.log(`\n--- redaction check ---`);
if (leakedSettings.length > 0) {
  console.log(`  FAIL: ${leakedSettings.length} effective-settings value(s) look secret-shaped`);
  process.exitCode = 1;
}
if (leaked.length === 0 && leakedSettings.length === 0) {
  console.log('  clean: nothing secret-shaped in any rendered field');
} else if (leaked.length > 0) {
  console.log(`  FAIL: ${leaked.length} asset(s) render something secret-shaped`);
  for (const a of leaked) {
    console.log(`    ${a.kind} ${a.name} (${a.sourcePath})`);
  }
  process.exitCode = 1;
}
console.log('');
