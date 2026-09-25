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
  /** The category this table covers ("all" for every vote). */
  category: LeaderboardCategory;
  /** Votes counted in this category. */
  totalVotes: number;
  blindOnly: boolean;
  rows: { modelId: string; rating: number; wins: number; losses: number; ties: number; games: number }[];
}

/** Leaderboard categories. Each comparison gets one, guessed from its prompt (the prompt isn't kept). */
export const COMPARE_CATEGORIES = ["general", "coding", "writing", "reasoning", "multilingual"] as const;
export type CompareCategory = (typeof COMPARE_CATEGORIES)[number];
/** The leaderboard over every category. */
export type LeaderboardCategory = CompareCategory | "all";

const CODING =
  /```|\b(code|coding|function|bug|debug|error|exception|stack ?trace|python|javascript|typescript|java|c\+\+|c#|rust|golang|kotlin|swift|php|ruby|sql|regex|api|json|html|css|react|node|compile|script|class|array|loop)\b|=>|\);/i;
const REASONING =
  /\b(why|prove|proof|calculate|compute|solve|math|equation|logic|logical|puzzle|riddle|probability|how many|estimate|reason)\b|\d+\s*[-+*/^×÷=]\s*\d+/i;
const WRITING =
  /\b(write|rewrite|draft|email|essay|poem|story|caption|tweet|post|letter|blog|headline|slogan|paragraph|summar(y|ise|ize)|translate|proofread|tone)\b/i;
const EN_WORDS = new Set(
  "the a an and or is are was what how why who when where to of in on for with this that it you i my me can do does".split(
    " ",
  ),
);
const OTHER_WORDS = new Set(
  (
    "yang dan apa bagaimana saya aku kamu untuk dengan tidak ini itu ada bisa jelaskan tolong buat dalam " +
    "el la los las que por para con una es como qué " +
    "le les des est une pour avec pas que qui " +
    "der die das und ist nicht mit ein eine wie was " +
    "o os as é um uma não com para como"
  ).split(" "),
);

/** Guess a comparison's category from its prompt. */
export function categorize(prompt: string): CompareCategory {
  if (CODING.test(prompt)) return "coding";
  const letters = prompt.match(/\p{L}/gu) ?? [];
  const latin = letters.filter((c) => /[A-Za-zÀ-ÿ]/.test(c)).length;
  if (letters.length >= 4 && latin / letters.length < 0.7) return "multilingual";
  const words = prompt.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const en = words.filter((x) => EN_WORDS.has(x)).length;
  const other = words.filter((x) => OTHER_WORDS.has(x)).length;
  if (other >= 2 && other > en) return "multilingual";
  if (REASONING.test(prompt)) return "reasoning";
  if (WRITING.test(prompt)) return "writing";
  return "general";
}
