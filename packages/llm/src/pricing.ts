/**
 * Prices in USD per million tokens, from Anthropic's published model table (checked October 2026).
 * Used for per-tenant cost tracking and budget caps, so unknown models are priced at the highest
 * rate: a cap should stop spending early, never late. Verify against your invoice, and override
 * with the MODEL_PRICING_JSON environment variable if rates change.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  // Haiku 5.5 is priced for prompts up to 100K tokens; longer prompts cost more, which this does not model.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

const MOST_EXPENSIVE: ModelPrice = { input: 10, output: 50, cacheRead: 0.25 };
/** Cache writes cost 1.25 times the input rate (5-minute cache). */
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Each web search request costs this much (Anthropic bills searches per request). Override with WEB_SEARCH_USD_PER_REQUEST. */
export const DEFAULT_WEB_SEARCH_USD = 0.01;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
}

export interface PricingConfig {
  prices?: Record<string, ModelPrice>;
  webSearchUsd?: number;
}

export function pricingFromEnv(env: Record<string, string | undefined>): PricingConfig {
  const cfg: PricingConfig = {};
  if (env.MODEL_PRICING_JSON) cfg.prices = JSON.parse(env.MODEL_PRICING_JSON);
  if (env.WEB_SEARCH_USD_PER_REQUEST) cfg.webSearchUsd = Number(env.WEB_SEARCH_USD_PER_REQUEST);
  return cfg;
}

export function priceFor(model: string, cfg: PricingConfig = {}): ModelPrice {
  return cfg.prices?.[model] ?? DEFAULT_PRICES[model] ?? MOST_EXPENSIVE;
}

export function costOf(model: string, usage: Usage, cfg: PricingConfig = {}): number {
  const p = priceFor(model, cfg);
  const fresh = usage.input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const tokens = (fresh * p.input + cacheWrite * p.input * CACHE_WRITE_MULTIPLIER + cacheRead * p.cacheRead + out * p.output) / 1_000_000;
  return tokens + searches * (cfg.webSearchUsd ?? DEFAULT_WEB_SEARCH_USD);
}
