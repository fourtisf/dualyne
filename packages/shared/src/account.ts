import type { Tier } from "./tiers";

/** GET /me */
export interface MeResponse {
  address: string;
  tier: Tier;
  tierLabel: string;
  tierSource: "override" | "credits" | "token" | "default";
  limits: { dailyRequests: number | null; maxTokens: number | null; maxKeys: number | null };
  usage: { today: number; remaining: number | null };
  keys: { count: number; max: number | null };
  /** Explorer-tier sybil check; null when it doesn't apply. */
  eligibility: { eligible: boolean; reason: string } | null;
  /** Prepaid Builder credit, in USD (present once credits are enabled). */
  credits?: { balanceUsd: number; enabled: boolean };
  /** Token holdings used for the Holder tier (present once the token is configured). */
  token?: { balance: number; holderMin: number; symbol: string } | null;
}

/** GET /me/keys item. POST /me/keys also returns `key` once. */
export interface KeyInfo {
  id: string;
  name: string | null;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  key?: string;
}

/** GET /me/usage */
export interface UsageResponse {
  days: { day: string; requests: number; costUsd: number }[];
  byKey: { keyId: string; last4: string; name: string | null; requests: number; costUsd: number }[];
}

/** OpenAI-style error body used by every API error. */
export interface ApiErrorBody {
  error: { message: string; type: string; code: string };
}
