import * as path from 'path';
import { isFile, readJson } from '../util/fs';

/**
 * Who is signed in to Claude Code, if anyone.
 *
 * This is the one place that opens `~/.claude.json`, and it is deliberately narrow: the
 * file also holds MCP definitions whose `env` blocks carry API keys in plaintext, so
 * only the four account fields below are ever lifted out of it. Nothing else from that
 * file reaches an Asset, a label or a tooltip.
 *
 * `~/.claude/.credentials.json` holds the actual OAuth token and is never opened at all.
 *
 * Being signed out is not an error -- the extension browses configuration on disk, which
 * exists whether or not anyone is logged in.
 */

interface OauthAccount {
  emailAddress?: string;
  accountUuid?: string;
  organizationName?: string;
  organizationRole?: string;
}

interface ClaudeConfig {
  oauthAccount?: OauthAccount;
}

export interface Account {
  signedIn: boolean;
  /** Display name: the email address when there is one. */
  label: string;
  organization?: string;
  role?: string;
  /** The file the answer came from, so the node can open it. */
  sourcePath: string;
}

export function readAccount(claudeHome: string): Account {
  // ~/.claude.json sits beside the ~/.claude directory, not inside it.
  const configPath = path.join(path.dirname(claudeHome), '.claude.json');

  if (!isFile(configPath)) {
    return { signedIn: false, label: 'Not signed in to Claude Code', sourcePath: configPath };
  }

  const config = readJson<ClaudeConfig>(configPath);
  const account = config?.oauthAccount;
  const email = account?.emailAddress?.trim();

  if (!email) {
    // A readable config with no account block: installed, not logged in.
    return { signedIn: false, label: 'Not signed in to Claude Code', sourcePath: configPath };
  }

  return {
    signedIn: true,
    label: email,
    organization: account?.organizationName?.trim() || undefined,
    role: account?.organizationRole?.trim() || undefined,
    sourcePath: configPath,
  };
}
