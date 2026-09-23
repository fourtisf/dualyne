/** Micro-USD: 1 = $0.000001. Integers keep the spend counter exact. */
export const usdToMicro = (usd: number): number => Math.max(0, Math.round(usd * 1_000_000));
export const microToUsd = (micro: number | bigint): number => Number(micro) / 1_000_000;

/** Cost in micro-USD from token counts and per-token prices. */
export const tokensCostMicro = (
  inputTokens: number,
  outputTokens: number,
  promptPrice: number,
  completionPrice: number,
): number => usdToMicro(inputTokens * promptPrice + outputTokens * completionPrice);

/** Rough token estimate for budget reservations (about 4 characters per token). */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);
