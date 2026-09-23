import { z } from "zod";
import { MODEL_ID_RE } from "./models";

export const COMPARE_PROMPT_MAX = 8000;

export const compareRequestSchema = z
  .object({
    prompt: z.string().trim().min(1, "Prompt is empty").max(COMPARE_PROMPT_MAX, "Prompt is too long"),
    a: z.string().regex(MODEL_ID_RE).optional(),
    b: z.string().regex(MODEL_ID_RE).optional(),
    /** Blind run: the server picks two free models and reveals them after the vote. */
    blind: z.boolean().optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict()
  .refine((r) => r.blind || (r.a && r.b), { message: "Pick two models, or run a blind comparison" });
export type CompareRequest = z.infer<typeof compareRequestSchema>;

export type Lane = "a" | "b";

/** Events on the /internal/compare SSE stream, keyed by SSE `event:` name. */
export interface CompareEvents {
  /** a/b are null in blind runs until the vote. */
  meta: { compareId: string; a: string | null; b: string | null; blind: boolean };
  delta: { lane: Lane; text: string };
  done: {
    lane: Lane;
    ttftMs: number | null;
    totalMs: number;
    outputTokens: number;
    costUsd: number;
  };
  error: { lane: Lane; code: CompareErrorCode };
  end: Record<string, never>;
}

export type CompareErrorCode = "upstream_failed" | "cancelled";

/** Error codes returned as JSON (non-200) by /internal/compare before streaming starts. */
export type CompareRejectCode =
  | "invalid_request"
  | "turnstile_failed"
  | "model_not_allowed"
  | "rate_limited"
  | "budget_exhausted"
  | "unavailable";

export const voteRequestSchema = z
  .object({
    compareId: z.string().min(1).max(40),
    winner: z.enum(["a", "b", "tie"]),
    /** Accepted for compatibility; the server uses the models recorded for the run. */
    a: z.string().regex(MODEL_ID_RE).optional(),
    b: z.string().regex(MODEL_ID_RE).optional(),
  })
  .strict();
export type VoteRequest = z.infer<typeof voteRequestSchema>;

/** POST /votes response. */
export interface VoteResponse {
  ok: true;
  counted: boolean;
  /** The models of the run (revealed after voting on a blind run). */
  a: string;
  b: string;
}

/** GET /leaderboard */
export interface LeaderboardResponse {
  updatedAt: string | null;
  totalVotes: number;
  blindOnly: boolean;
  rows: { modelId: string; rating: number; wins: number; losses: number; ties: number; games: number }[];
}
