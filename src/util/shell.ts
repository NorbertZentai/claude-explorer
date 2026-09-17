/**
 * Quote one argument for the shell a VS Code terminal runs: single quotes everywhere, which
 * POSIX shells and PowerShell both treat as literal. Only the quote character itself needs
 * escaping, and each shell does that differently.
 */
export function shellQuote(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A slash command as Claude Code names it: `/deploy`, `/plugin:skill`. Nothing else. */
export const INVOCATION = /^\/[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

/**
 * One line, because both destinations are line-oriented: a shell command line, and the prompt of
 * a running Claude Code session, where a newline submits whatever has been typed so far.
 */
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/** The command line that starts Claude Code with an initial prompt, one line. */
export function claudeCommandLine(prompt: string, platform: NodeJS.Platform = process.platform): string {
  return `claude ${shellQuote(oneLine(prompt), platform)}`;
}
