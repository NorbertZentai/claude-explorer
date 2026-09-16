/**
 * The single choke point for anything that comes out of an MCP server's `env` block.
 *
 * Claude's MCP definitions carry credentials in plaintext -- an `env` of
 * `{"SOME_API_KEY": "live_abc123..."}` is normal and expected. This extension renders
 * config into a tree, which is one careless JSON.stringify away from putting a live
 * credential on screen and into a screenshot.
 *
 * So values never leave this module. Only names do. There is deliberately no function
 * here that returns a value, not even a masked or truncated one: a prefix is still a
 * disclosure, and a length is still a hint.
 */

/** Names of the variables an env block defines, sorted. Never their values. */
export function envVarNames(env: unknown): string[] {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return [];
  }
  return Object.keys(env as Record<string, unknown>).sort();
}

/** A one-line summary of an env block for a tooltip: names only, never values. */
export function describeEnv(env: unknown): string | undefined {
  const names = envVarNames(env);
  if (names.length === 0) {
    return undefined;
  }
  return `${names.length} environment variable${names.length === 1 ? '' : 's'}: ${names.join(', ')} (values not shown)`;
}

/**
 * A command line is safe to display -- it is what `claude mcp list` prints -- but a
 * credential passed as an argument would not be. Redact anything that looks like one
 * while leaving the readable parts of the command intact.
 */
// The name may follow other text, as in a permission rule: `Bash(PGPASSWORD=… psql:*)`.
const SECRET_ARG = /^(?:.*[^A-Za-z0-9_-])?(?:[A-Za-z0-9_-]*(?:key|token|secret|password|passwd|pwd|credential)[A-Za-z0-9_-]*)=(.+)$/i;
const SECRET_LOOKING = /^(?:sk|pk|ghp|gho|xox[abps]|ocr_live|live|api)[-_][A-Za-z0-9_-]{12,}$/i;

export function redactCommandLine(parts: readonly string[]): string {
  return parts
    .map((part) => {
      const kv = SECRET_ARG.exec(part);
      if (kv) {
        return part.slice(0, part.length - kv[1].length) + '••••••';
      }
      if (SECRET_LOOKING.test(part)) {
        return '••••••';
      }
      return part;
    })
    .join(' ');
}

const SECRET_KEY = /key|token|secret|password|pwd|credential|auth/i;

/**
 * A settings value made safe to display. Used by the effective-settings view, which, unlike
 * the tree, shows values: `model: "opus"` is useful, a token under `apiKey` must not be.
 * A key whose name suggests a credential is masked outright; any other string is treated
 * like a command line, so an embedded `TOKEN=...` or a token-shaped word is masked too.
 */
export function redactValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== 'string') {
    // Callers flatten objects to leaves first; never stringify one wholesale.
    return typeof value === 'object' ? (Array.isArray(value) ? '[…]' : '{…}') : String(value);
  }
  if (SECRET_KEY.test(key) && !/helper$/i.test(key)) {
    return '••••••';
  }
  return redactCommandLine(value.split(/\s+/));
}

/**
 * Free text from outside, such as an MCP server's stderr, made safe to show: every word
 * that looks like a credential or a `KEY=value` secret is masked, line structure kept.
 */
export function redactText(text: string): string {
  return text
    .split('\n')
    .map((line) => redactCommandLine(line.split(' ')))
    .join('\n');
}
