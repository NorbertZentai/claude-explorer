import { Asset } from '../discovery/types';

/**
 * Configuration that changed lately, newest first and grouped by calendar day, from the
 * modification times discovery already records. Plans and auto-memory churn on their own,
 * so they are left out unless asked for.
 */

export interface RecentDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  assets: Asset[];
}

const NOISY = new Set<Asset['kind']>(['plan']);

export function recentChanges(assets: readonly Asset[], now: number, days = 14): RecentDay[] {
  const since = now - days * 86_400_000;
  const seen = new Set<string>();
  const recent = assets
    .filter((a) => !a.placeholder && !NOISY.has(a.kind) && a.modified !== undefined && a.modified >= since)
    .filter((a) => {
      // Several rows can come from one settings file; list the file once per kind and name.
      const key = `${a.kind}|${a.sourcePath}|${a.name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));

  const byDay = new Map<string, Asset[]>();
  for (const asset of recent) {
    const day = localDay(asset.modified!);
    const list = byDay.get(day) ?? [];
    list.push(asset);
    byDay.set(day, list);
  }
  return [...byDay.entries()].map(([day, list]) => ({ day, assets: list }));
}

export function localDay(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A stable identity for "was this here when the session started?". */
export function assetKey(asset: Pick<Asset, 'kind' | 'scope' | 'sourcePath' | 'name'>): string {
  return `${asset.kind}|${asset.scope.root}|${asset.sourcePath}|${asset.name}`;
}
