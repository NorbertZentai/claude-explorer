import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// `vscode` is provided by the host at runtime and must never be bundled.
const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  // jsonc-parser's `main` is a UMD build whose internal requires esbuild cannot follow;
  // its ES module build bundles cleanly.
  mainFields: ['module', 'main'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

// The discovery layer imports no `vscode`, so it also builds as a plain Node program.
await esbuild.build({
  entryPoints: ['src/audit.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/audit.js',
  external: ['vscode'],
  logLevel: 'warning',
});
