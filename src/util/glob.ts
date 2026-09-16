/**
 * Glob to regular expression, gitignore-flavoured: `**` crosses `/`, `*` and `?` stay within
 * one segment. With `slashAware` false, `*` matches anything (tool-name globs).
 */
export function globToRegExp(glob: string, slashAware = true): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += slashAware ? '[^/]*' : '.*';
      }
    } else if (ch === '?') {
      out += slashAware ? '[^/]' : '.';
    } else if (ch === '{' && glob.indexOf('}', i) !== -1) {
      const end = glob.indexOf('}', i);
      out += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((alt) => globToRegExp(alt, slashAware).source.slice(1, -1))
        .join('|')})`;
      i = end;
    } else {
      out += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match an absolute path against a glob, with Windows separators normalised to `/`. */
export function matchesPathGlob(pattern: string, file: string): boolean {
  const posix = (p: string): string => p.replace(/\\/g, '/');
  return globToRegExp(posix(pattern)).test(posix(file));
}
