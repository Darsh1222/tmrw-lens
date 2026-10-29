// USD per 1M tokens, Standard mode, from https://dev.meta.ai/docs/pricing-rate-limits
// (checked 2026-10-28). Reasoning tokens are billed as output tokens.
const TOKEN_PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

// SAM 3.1 is billed per image segmented: $2.50 per 1,000 images.
export const SAM_PRICE_PER_IMAGE = 2.5 / 1000;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
};

export function tokenPrices(model: string) {
  const prices = TOKEN_PRICES[model];
  // An unknown model must not slip past the spend cap as "free".
  if (!prices) throw new Error(`No price for model ${model}; add it to src/lib/meta/pricing.ts`);
  return prices;
}

export function tokenCostUsd(model: string, usage: Usage): number {
  const p = tokenPrices(model);
  const uncached = Math.max(0, usage.input_tokens - usage.cached_tokens);
  return (uncached * p.input + usage.cached_tokens * p.cachedInput + usage.output_tokens * p.output) / 1e6;
}

// Image token accounting isn't documented. This is a deliberately high guess per
// image; `pnpm smoke` prints real input_tokens per image so it can be tuned.
export const IMAGE_TOKEN_ESTIMATE = 3_000;
// A native PDF becomes text plus up to 50 page images on Meta's side.
export const FILE_TOKEN_ESTIMATE = 20 * IMAGE_TOKEN_ESTIMATE;

export type CallShape = { textChars: number; images: number; files: number; maxOutputTokens: number };

// Upper bound for one call, reserved against the daily cap before it is sent.
export function worstCaseCostUsd(model: string, shape: CallShape): number {
  const p = tokenPrices(model);
  const inputTokens =
    Math.ceil(shape.textChars / 3) + shape.images * IMAGE_TOKEN_ESTIMATE + shape.files * FILE_TOKEN_ESTIMATE;
  return (inputTokens * p.input + shape.maxOutputTokens * p.output) / 1e6;
}
