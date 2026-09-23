import { TIER_DEFAULTS, type Tier, type TierPolicy } from "@refract/shared";
import type { Env } from "./env";

export type TierPolicies = Record<Tier, TierPolicy>;

/** Launch tier numbers with any env overrides applied. */
export function tierPolicies(env: Env): TierPolicies {
  return {
    explorer: {
      ...TIER_DEFAULTS.explorer,
      dailyRequests: env.TIER_EXPLORER_DAILY ?? TIER_DEFAULTS.explorer.dailyRequests,
      maxTokens: env.TIER_EXPLORER_MAX_TOKENS ?? TIER_DEFAULTS.explorer.maxTokens,
    },
    holder: {
      ...TIER_DEFAULTS.holder,
      dailyRequests: env.TIER_HOLDER_DAILY ?? TIER_DEFAULTS.holder.dailyRequests,
      maxTokens: env.TIER_HOLDER_MAX_TOKENS ?? TIER_DEFAULTS.holder.maxTokens,
    },
    builder: {
      ...TIER_DEFAULTS.builder,
      maxTokens: env.TIER_BUILDER_MAX_TOKENS ?? TIER_DEFAULTS.builder.maxTokens,
    },
  };
}
