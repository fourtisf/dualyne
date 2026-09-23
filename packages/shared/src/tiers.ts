export const TIERS = ["explorer", "holder", "builder"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierPolicy {
  label: string;
  rank: number;
  /** Requests per UTC day. null = no cap. */
  dailyRequests: number | null;
  /** Ceiling applied to max_tokens. null = no Refract ceiling (the model's own limit applies). */
  maxTokens: number | null;
  /** API keys per wallet. null = unlimited. */
  maxKeys: number | null;
  /** Free tiers are paid for by the treasury and stop when the daily budget cap is hit. */
  free: boolean;
}

/** Launch defaults. The API can override the numbers through env variables. */
export const TIER_DEFAULTS: Record<Tier, TierPolicy> = {
  explorer: { label: "Explorer", rank: 0, dailyRequests: 20, maxTokens: 1000, maxKeys: 1, free: true },
  holder: { label: "Holder", rank: 1, dailyRequests: 250, maxTokens: 4000, maxKeys: 5, free: true },
  builder: { label: "Builder", rank: 2, dailyRequests: null, maxTokens: null, maxKeys: null, free: false },
};

export const tierAllows = (tier: Tier, minTier: Tier): boolean =>
  TIER_DEFAULTS[tier].rank >= TIER_DEFAULTS[minTier].rank;
