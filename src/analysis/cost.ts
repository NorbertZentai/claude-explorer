/**
 * What the configuration measured by the context budget costs per request, at API list
 * prices. A subscription is not billed this way, so the numbers are a yardstick for
 * comparing setups, not a bill. Prices are USD per million tokens from
 * platform.claude.com/docs/en/about-claude/pricing, as of PRICES_AS_OF; override them with
 * `claudeExplorer.inputPricePerMTok` when they move.
 */

export const PRICES_AS_OF = '2026-09-16';

export type CostModelId = 'opus-5' | 'sonnet-5' | 'haiku-4-5' | 'fable-5-1';

export interface ModelPrice {
  id: CostModelId;
  label: string;
  input: number;
  cacheWrite5m: number;
  cacheRead: number;
}

export const MODEL_PRICES: Record<CostModelId, ModelPrice> = {
  'fable-5-1': { id: 'fable-5-1', label: 'Claude Fable 5.1', input: 10, cacheWrite5m: 12.5, cacheRead: 0.25 },
  'opus-5': { id: 'opus-5', label: 'Claude Opus 5', input: 5, cacheWrite5m: 6.25, cacheRead: 0.5 },
  'sonnet-5': { id: 'sonnet-5', label: 'Claude Sonnet 5', input: 2, cacheWrite5m: 2.5, cacheRead: 0.2 },
  'haiku-4-5': { id: 'haiku-4-5', label: 'Claude Haiku 4.5', input: 1, cacheWrite5m: 1.25, cacheRead: 0.1 },
};

export interface CostEstimate {
  model: ModelPrice;
  /** How the model was chosen, for the label. */
  basis: string;
  tokens: number;
  /** First request, nothing cached: written to the 5-minute cache. */
  firstRequest: number;
  /** A later request within the cache window. */
  cachedRequest: number;
  /** Without any caching. */
  uncached: number;
}

/**
 * `setting` is `claudeExplorer.costModel`; `effectiveModel` the `model` value the session
 * would start with, if any settings file sets one.
 */
export function pickModel(setting: string | undefined, effectiveModel: string | undefined): { model: ModelPrice; basis: string } {
  if (setting && setting !== 'auto' && setting in MODEL_PRICES) {
    return { model: MODEL_PRICES[setting as CostModelId], basis: 'claudeExplorer.costModel' };
  }
  const m = (effectiveModel ?? '').toLowerCase();
  const family = m.includes('fable') ? 'fable-5-1' : m.includes('haiku') ? 'haiku-4-5' : m.includes('sonnet') ? 'sonnet-5' : m.includes('opus') ? 'opus-5' : undefined;
  if (family) {
    return { model: MODEL_PRICES[family], basis: `model "${effectiveModel}" in settings` };
  }
  return { model: MODEL_PRICES['opus-5'], basis: 'assumed; no model set in settings' };
}

export function estimateCost(tokens: number, model: ModelPrice, basis: string, inputOverride?: number): CostEstimate {
  const price = inputOverride && inputOverride > 0
    ? { ...model, input: inputOverride, cacheWrite5m: inputOverride * 1.25, cacheRead: inputOverride * (model.cacheRead / model.input) }
    : model;
  const per = (usdPerMTok: number): number => (tokens * usdPerMTok) / 1_000_000;
  return {
    model: price,
    basis: inputOverride && inputOverride > 0 ? `${basis}, input price overridden` : basis,
    tokens,
    firstRequest: per(price.cacheWrite5m),
    cachedRequest: per(price.cacheRead),
    uncached: per(price.input),
  };
}

export function formatUsd(value: number): string {
  if (value === 0) {
    return '$0';
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}
