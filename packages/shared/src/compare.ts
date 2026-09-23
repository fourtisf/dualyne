import { z } from "zod";
import { MODEL_ID_RE } from "./models";

export const COMPARE_PROMPT_MAX = 8000;

export const compareRequestSchema = z
  .object({
    prompt: z.string().trim().min(1, "Prompt is empty").max(COMPARE_PROMPT_MAX, "Prompt is too long"),
    a: z.string().regex(MODEL_ID_RE),
    b: z.string().regex(MODEL_ID_RE),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict();
export type CompareRequest = z.infer<typeof compareRequestSchema>;

export type Lane = "a" | "b";

/** Events on the /internal/compare SSE stream, keyed by SSE `event:` name. */
export interface CompareEvents {
  meta: { compareId: string; a: string; b: string };
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
