import type { AppContext } from "../context";
import { isRefusal } from "../budget";
import { sha256Hex } from "../lib/hash";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { readUsage } from "../openrouter/sse";

const MAX_OUTPUT_TOKENS = 160;
/** How much of the answer the suggester reads. */
const ANSWER_CHARS = 3000;
const CACHE_SECONDS = 86_400;
const TIMEOUT_MS = 8000;

const SYSTEM = `You suggest what a user might ask next in a chat with an AI assistant.
Given their question and the answer they got, write exactly 3 short follow-up questions they are likely to ask next.
Rules: write in the same language as the user's question; each question under 12 words; make them specific to the answer, varied (go deeper, practical next step, related topic); no numbering.
Reply with only a JSON array of 3 strings.`;

/** Pull up to 3 clean questions out of the model's reply (JSON, or one per line as a fallback). */
export function parseSuggestions(text: string): string[] {
  let items: unknown[] = [];
  const json = text.match(/\[[\s\S]*\]/)?.[0];
  if (json) {
    try {
      const v = JSON.parse(json) as unknown;
      if (Array.isArray(v)) items = v;
    } catch {
      /* fall back to lines */
    }
  }
  if (!items.length) items = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const q = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^["'“”]+|["'“”,]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (q.length < 6 || q.length > 140 || /^[[\]{}]/.test(q)) continue;
    if (out.some((x) => x.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Up to 3 follow-up questions for a question and its answer, written by a small free model
 * (CHAT_SUGGEST_MODEL), cached per answer and kept inside the daily budget. Returns [] when
 * suggestions are off, the budget is spent, or anything fails: they are a nicety, never an error.
 */
export async function suggestFollowUps(ctx: AppContext, question: string, answer: string): Promise<string[]> {
  const { env } = ctx;
  if (!env.CHAT_SUGGEST_MODEL || !env.OPENROUTER_API_KEY) return [];
  const cacheKey = `chatsug:${sha256Hex(`${question}\n${answer}`)}`;
  const cached = await ctx.redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as string[];

  const model = await ctx.prisma.model.findUnique({ where: { id: env.CHAT_SUGGEST_MODEL } });
  if (!model?.enabled) return [];
  const user = `Question:\n${question.slice(0, 2000)}\n\nAnswer:\n${answer.slice(0, ANSWER_CHARS)}`;
  const inTok = estimateTokens(SYSTEM.length + user.length);
  const price = [Number(model.promptPrice), Number(model.completionPrice)] as const;
  const reservation = await ctx.budget.reserve(tokensCostMicro(inTok, MAX_OUTPUT_TOKENS, ...price), true);
  if (isRefusal(reservation)) return [];

  let cost = 0;
  let questions: string[] = [];
  try {
    const res = await ctx.openrouter.chat(
      {
        model: model.openrouterId,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        usage: { include: true },
      },
      AbortSignal.timeout(TIMEOUT_MS),
    );
    if (res.ok) {
      const json = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
      };
      const text = json.choices?.[0]?.message?.content;
      questions = typeof text === "string" ? parseSuggestions(text) : [];
      const u = readUsage(json);
      cost =
        u?.costUsd != null
          ? usdToMicro(u.costUsd)
          : tokensCostMicro(u?.promptTokens ?? inTok, u?.completionTokens ?? MAX_OUTPUT_TOKENS, ...price);
    } else {
      await res.text().catch(() => "");
    }
  } catch {
    /* timeout, network or a reply that isn't JSON: no suggestions */
  } finally {
    await ctx.budget.settle(reservation, cost);
  }
  if (questions.length) await ctx.redis.set(cacheKey, JSON.stringify(questions), "EX", CACHE_SECONDS);
  return questions;
}
