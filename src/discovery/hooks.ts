import * as os from 'os';
import * as path from 'path';
import { findLine, isFile, readJson, readText } from '../util/fs';
import { Asset, Scope } from './types';

/**
 * Hooks are declared in FOUR places, and a tool that reads only the obvious one is
 * wrong on this machine:
 *
 *   ~/.claude/settings.json                       user
 *   <project>/.claude/settings.json               project, shared
 *   <project>/.claude/settings.local.json         project, private
 *   <plugin>/hooks/hooks.json                     plugin -- different wrapper shape
 *
 * The plugin form nests the same structure under a top-level object with its own
 * `description`, and its commands use ${CLAUDE_PLUGIN_ROOT} rather than
 * $CLAUDE_PROJECT_DIR.
 */

interface HookCommand {
  type?: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
}

type HookMap = Record<string, HookMatcher[]>;

interface SettingsWithHooks {
  hooks?: HookMap;
}

interface PluginHooksFile {
  description?: string;
  hooks?: HookMap;
}

export function discoverHooksFromSettings(file: string, scope: Scope): Asset[] {
  const settings = readJson<SettingsWithHooks>(file);
  if (!settings?.hooks) {
    return [];
  }
  return flatten(settings.hooks, file, scope, variablesFor(scope, file));
}

export function discoverPluginHooks(pluginRoot: string, scope: Scope): Asset[] {
  const file = path.join(pluginRoot, 'hooks', 'hooks.json');
  const parsed = readJson<PluginHooksFile>(file);
  if (!parsed?.hooks) {
    return [];
  }
  return flatten(parsed.hooks, file, scope, { CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: os.homedir() });
}

function flatten(
  hooks: HookMap,
  file: string,
  scope: Scope,
  vars: Record<string, string>,
): Asset[] {
  const text = readText(file);
  const out: Asset[] = [];

  for (const [event, matchers] of Object.entries(hooks)) {
    // A hand-edited settings file can put an object where an array belongs. That must
    // produce nothing, never a TypeError that empties the whole tree.
    if (!Array.isArray(matchers)) {
      continue;
    }
    for (const matcher of matchers) {
      for (const hook of Array.isArray(matcher?.hooks) ? matcher.hooks : []) {
        const command = hook.command ?? '';
        const script = scriptPath(command, vars);
        const detail: Record<string, string> = {
          Event: event,
          // A hook with no matcher runs for everything; saying so beats an empty row.
          Matcher: matcher.matcher ?? '(all)',
          Command: command,
        };
        if (hook.timeout !== undefined) {
          detail['Timeout'] = `${hook.timeout}s`;
        }
        if (hook.statusMessage) {
          detail['Status message'] = hook.statusMessage;
        }

        out.push({
          kind: 'hook',
          name: hook.statusMessage || `${event}${matcher.matcher ? ` · ${matcher.matcher}` : ''}`,
          description: script ? path.basename(script) : command,
          scope,
          // Open the script itself when it can be resolved -- that is what you want to
          // read. Fall back to the settings file that declares it.
          sourcePath: script && isFile(script) ? script : file,
          line: script && isFile(script) ? undefined : findLine(text, command.slice(0, 40)),
          detail,
          problem:
            script && !isFile(script)
              ? `Script not found: ${script}`
              : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * Pull the script out of a command line like:
 *   bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"
 *   python3 "${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py"
 * Returns undefined when the command is not of that shape, in which case there is
 * nothing to existence-check and no file to open.
 */
function scriptPath(command: string, vars: Record<string, string>): string | undefined {
  const quoted = /"([^"]+)"|'([^']+)'/.exec(command);
  const candidate = quoted ? (quoted[1] ?? quoted[2]) : undefined;
  if (!candidate) {
    return undefined;
  }
  // `~` is how POSIX hooks are normally written and was previously left literal, which
  // reported "Script not found" for scripts that exist.
  const withHome = candidate.startsWith('~/') || candidate === '~'
    ? path.join(os.homedir(), candidate.slice(1))
    : candidate;
  const expanded = withHome
    .replace(/\$\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole)
    .replace(/\$(\w+)/g, (whole, name: string) => vars[name] ?? whole);
  if (/\$\{?\w+/.test(expanded)) {
    return undefined; // an unresolved variable; do not claim the file is missing
  }
  return path.normalize(expanded);
}

function variablesFor(scope: Scope, file: string): Record<string, string> {
  // `$CLAUDE_PROJECT_DIR` points at the project root, i.e. the parent of `.claude`.
  const claudeDir = path.dirname(file);
  const projectDir = path.basename(claudeDir) === '.claude' ? path.dirname(claudeDir) : claudeDir;
  return {
    HOME: os.homedir(),
    USERPROFILE: os.homedir(),
    CLAUDE_PROJECT_DIR: scope.kind === 'workspace' ? scope.root : projectDir,
  };
}
