/**
 * Headless run of the discovery layer: `npm run audit [folder ...]`.
 *
 * This exists because the discovery modules deliberately import no `vscode` API, which
 * makes them runnable in plain Node. It is the fastest way to see what the tree will
 * contain without launching an Extension Development Host, and it doubles as the
 * regression check -- if the counts move, something changed.
 */
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
console.log(`\n--- redaction check ---`);
if (leaked.length === 0) {
  console.log('  clean: nothing secret-shaped in any rendered field');
} else {
  console.log(`  FAIL: ${leaked.length} asset(s) render something secret-shaped`);
  for (const a of leaked) {
    console.log(`    ${a.kind} ${a.name} (${a.sourcePath})`);
  }
  process.exitCode = 1;
}
console.log('');
