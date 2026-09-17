import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundles `test/**\/*.test.ts` into `out/test` so plain `node --test` can run them.
 *
 * Separate from esbuild.mjs on purpose: `compile` is the preLaunchTask of the F5 launch
 * config, and `vscode:prepublish` runs esbuild.mjs, so keeping the test build in its own
 * file makes it structurally impossible for test code to reach the VSIX.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(here, 'test');
const watch = process.argv.includes('--watch');

const entryPoints = readdirSync(testDir, { recursive: true })
  .map(String)
  .filter((rel) => rel.endsWith('.test.ts'))
  .map((rel) => path.join(testDir, rel));

// `node --test "glob"` exits 0 when nothing matches, so an empty build would leave CI
// permanently green and permanently empty. Fail here, where it is visible.
if (entryPoints.length === 0) {
  throw new Error('No test/**/*.test.ts found -- refusing to produce an empty test run.');
}

const options = {
  entryPoints,
  outbase: testDir,
  outdir: path.join(here, 'out', 'test'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // Every `import … from 'vscode'`, in src/ and in test/, resolves to the stub. Absolute,
  // because esbuild resolves a relative alias against the working directory, not the
  // importing file. Deliberately no `external: ['vscode']` -- bundling the stub is the point.
  alias: { vscode: path.join(testDir, 'stubs', 'vscode.ts') },
  // src/edit/jsonText.ts reaches jsonc-parser, whose UMD `main` does not bundle cleanly.
  mainFields: ['module', 'main'],
  sourcemap: 'inline',
  sourcesContent: true,
  logLevel: 'warning',
};

const run = () =>
  spawn(
    process.execPath,
    ['--test-reporter=spec', '--enable-source-maps', '--test', 'out/test/**/*.test.js'],
    { stdio: 'inherit', cwd: here },
  );

if (!watch) {
  await esbuild.build(options);
} else {
  let child;
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'rerun',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length > 0) {
              return;
            }
            child?.kill();
            child = run();
          });
        },
      },
    ],
  });
  await ctx.watch();
}
