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
  eligibility: {
    eligible: boolean;
    /** English explanation. */
    reason: string;
    code?: "requirement" | "check_failed";
    requirement?: { minEth: number; minAgeDays: number };
  } | null;
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

/** GET /me/credits */
export type CreditsResponse =
  | { enabled: false }
  | {
      enabled: true;
      balanceUsd: number;
      markup: number;
      chainId: number;
      depositAddress: string;
      usdgAddress: string | null;
      usdgDecimals: number | null;
      ethEnabled: boolean;
      confirmations: number;
      deposits: { txHash: string; asset: string; amount: string; usd: number; createdAt: string }[];
    };

/** POST /me/credits/deposits */
export type DepositResponse =
  | { status: "pending"; confirmations: number; required: number }
  | { status: "credited"; usd: number; balanceUsd: number; asset?: string; amount?: string };

/** GET /status: public service health, built from real traffic in the last hour. */
export type ServiceState = "operational" | "degraded" | "down";
export interface StatusResponse {
  status: ServiceState;
  checkedAt: string;
  services: { api: "ok"; database: "ok" | "down"; cache: "ok" | "down" };
  /** Free comparisons on the website: paused once the day's treasury budget is spent. */
  freeCompare: { state: "available" | "paused"; resumesAt: string | null };
  models: {
    id: string;
    name: string;
    state: ServiceState | "unavailable";
    /** Upstream calls in the last hour (API and Compare). */
    requests: number;
    /** Share of those calls that failed upstream (0–1), null with no traffic. */
    errorRate: number | null;
    /** Median time to first token in ms, null with no streamed traffic. */
    ttftMs: number | null;
  }[];
  jobs: { modelsVerifiedAt: string | null; treasurySyncedAt: string | null };
}
