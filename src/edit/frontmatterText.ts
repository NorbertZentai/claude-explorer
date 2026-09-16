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
