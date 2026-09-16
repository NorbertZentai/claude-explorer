/**
 * Rewrite the `name:` line of a markdown file's frontmatter, leaving everything else as it
 * was. Only a frontmatter block that starts on the first line counts, as in Claude Code.
 *
 * `onlyIf` restricts the change to a name that currently equals that value, so a display
 * name the author chose on purpose survives a rename of the file or folder.
 */
export function renameFrontmatterName(text: string, newName: string, onlyIf?: string): string {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return text;
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      break;
    }
    const match = /^name:\s*(.*?)\s*$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    const current = match[1].replace(/^(['"])(.*)\1$/, '$2');
    if (onlyIf !== undefined && current !== onlyIf) {
      return text;
    }
    const quote = /^['"]/.exec(match[1])?.[0] ?? '';
    lines[i] = `name: ${quote}${newName}${quote}`;
    return lines.join('\n');
  }
  return text;
}

/**
 * Set a single-line frontmatter value, adding the key (and the frontmatter block) when it is
 * missing. Throws rather than guess when the current value spans several lines, such as a
 * `|` block scalar, because rewriting that one line would leave the rest dangling.
 */
export function setFrontmatterScalar(text: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const rendered = `${key}: ${yamlScalar(value)}`;
  if (lines[0]?.trim() !== '---') {
    return ['---', rendered, '---', ...lines].join(eol);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error('The frontmatter block is not closed with ---, so it was left untouched.');
  }
  const keyLine = new RegExp(`^${key.replace(/[-]/g, '\\-')}\\s*:(.*)$`);
  for (let i = 1; i < end; i++) {
    const match = keyLine.exec(lines[i]);
    if (!match) {
      continue;
    }
    const current = match[1].trim();
    const continued = i + 1 < end && /^\s+\S/.test(lines[i + 1]) && !/^\s*-\s/.test(lines[i + 1]);
    if (/^[|>]/.test(current) || continued) {
      throw new Error(`${key} spans several lines here. Edit it in the file instead.`);
    }
    lines[i] = rendered;
    return lines.join(eol);
  }
  // Keep `name` first when it is there.
  const after = lines.findIndex((l, i) => i > 0 && i < end && /^name\s*:/.test(l));
  lines.splice(after === -1 ? 1 : after + 1, 0, rendered);
  return lines.join(eol);
}

/** A YAML scalar that reads back as exactly `value`: plain when safe, double-quoted otherwise. */
export function yamlScalar(value: string): string {
  const plainSafe =
    /^[A-Za-z0-9(][^\n]*$/.test(value) &&
    !/[:#]\s|\s#|:$/.test(value) &&
    !/^(true|false|yes|no|on|off|null|~|[-+]?\d[\d._]*(e[-+]?\d+)?)$/i.test(value) &&
    value === value.trim() &&
    !/["'`{}[\],&*!|>%@]/.test(value[0]);
  if (plainSafe) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
