import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TestContext } from 'node:test';

/** A directory as a literal: a string is file contents, an object is a subdirectory. */
export interface Tree {
  [name: string]: string | Tree;
}

export interface FixtureOptions {
  /** Point CLAUDE_CONFIG_DIR at `<dir>/.claude`. Default true. */
  configDir?: boolean;
  /**
   * Also point os.homedir() at `<dir>/home` by setting HOME and USERPROFILE, which Node
   * honours on both platforms. Off by default: it is process-global, and tests within one
   * file share a process, so only use it in a file whose tests all want it.
   */
  home?: boolean;
}

export interface Fixture {
  /**
   * The temp root, already through fs.realpathSync.native. Compare path assertions against
   * THIS, never against os.tmpdir(): discovery stores realPath(root), and macOS resolves
   * /var to /private/var while Windows expands 8.3 short names.
   */
  readonly dir: string;
  /** `<dir>/.claude`, which is what CLAUDE_CONFIG_DIR points at. */
  readonly claudeDir: string;
  /** `<dir>/home` when `home: true`. */
  readonly home?: string;
  path(...segments: string[]): string;
  write(relative: string, contents: string): string;
  dispose(): void;
}

export function fixture(tree: Tree, options: FixtureOptions = {}): Fixture {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-explorer-')));
  materialise(dir, tree);

  const restore: Array<() => void> = [];
  const setEnv = (name: string, value: string): void => {
    const previous = process.env[name];
    restore.push(() => {
      if (previous === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous;
      }
    });
    process.env[name] = value;
  };

  const claudeDir = path.join(dir, '.claude');
  if (options.configDir !== false) {
    setEnv('CLAUDE_CONFIG_DIR', claudeDir);
  }

  let home: string | undefined;
  if (options.home) {
    home = path.join(dir, 'home');
    fs.mkdirSync(home, { recursive: true });
    setEnv('HOME', home);
    setEnv('USERPROFILE', home);
  }

  return {
    dir,
    claudeDir,
    home,
    path: (...segments) => path.join(dir, ...segments),
    write(relative, contents) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents, 'utf8');
      return target;
    },
    dispose() {
      for (const undo of restore.reverse()) {
        undo();
      }
      // maxRetries: on Windows an indexer or AV can hold a handle briefly after a write.
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

/** The form to use inside a test: cleanup is registered for you. */
export function useFixture(t: TestContext, tree: Tree, options?: FixtureOptions): Fixture {
  const fx = fixture(tree, options);
  t.after(() => fx.dispose());
  return fx;
}

function materialise(base: string, tree: Tree): void {
  fs.mkdirSync(base, { recursive: true });
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(base, name);
    if (typeof value === 'string') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value, 'utf8');
    } else {
      materialise(target, value);
    }
  }
}

/** Frontmatter + body, written the way a real SKILL.md or command file looks. */
export function md(frontmatter: Record<string, string>, body = 'Body.\n'): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
