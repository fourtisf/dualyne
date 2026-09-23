import { MODEL_ID_RE, tierAllows } from "@dualyne/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { isRefusal } from "../budget";
import { ApiError } from "../lib/errors";
import { plainHeaders, SSE_HEADERS, writeRaw } from "../lib/http";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { secondsUntilUtcMidnight } from "../lib/time";
import { readEvents, readUsage, StreamInspector, type UsageInfo } from "../openrouter/sse";
import { logUsage } from "../usage/log";

/** Retry-After for a request refused while in-flight requests hold the free budget. */
export const BUSY_RETRY_SECONDS = 10;

/** Preview mode: without an OpenRouter key the site is live but no model can be called. */
export function assertModelsLive(ctx: AppContext, message: string): void {
  if (!ctx.env.OPENROUTER_API_KEY) throw new ApiError(503, "models_not_live", message);
}

const optionalPositiveInt = z.number().int().positive().max(10_000_000).nullish();

export const chatBodySchema = z
  .object({
    model: z.string({ required_error: "model is required" }).regex(MODEL_ID_RE, "Unknown model id"),
    messages: z
      .array(z.object({ role: z.string().min(1).max(32) }).passthrough(), {
        required_error: "messages is required",
      })
      .min(1, "messages must not be empty")
      .max(2000),
    stream: z.boolean().nullish(),
    stream_options: z.object({ include_usage: z.boolean().nullish() }).passthrough().nullish(),
    max_tokens: optionalPositiveInt,
    max_completion_tokens: optionalPositiveInt,
    n: z.literal(1, { errorMap: () => ({ message: "n > 1 is not supported" }) }).nullish(),
    tools: z.array(z.record(z.unknown())).max(128).nullish(),
  })
  .passthrough();

/**
 * OpenRouter-only fields that could bypass the model mapping, add paid features outside the
 * budget estimate, or override our usage accounting. They are removed before proxying.
 */
const STRIPPED_FIELDS = ["models", "route", "plugins", "transforms", "preset", "usage", "web_search_options"];

/** Stop waiting for upstream response headers after this long. */
const UPSTREAM_HEADERS_TIMEOUT_MS = 120_000;
/** Output tokens assumed for the budget reservation when the tier has no max_tokens ceiling. */
const DEFAULT_OUTPUT_ESTIMATE = 4096;

interface RouteOpts {
  routeConfig: Record<string, unknown>;
}

export const chatRoutes: FastifyPluginAsync<RouteOpts> = async (app, opts) => {
  const { ctx } = app;

  app.post(
    "/v1/chat/completions",
    { config: opts.routeConfig, bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      const startedAt = Date.now();
      const principal = await ctx.auth.authenticate(req.headers.authorization);
      assertModelsLive(ctx, "Model access is not switched on yet. Try again soon.");
      const body = chatBodySchema.parse(req.body);

      const model = await ctx.prisma.model.findUnique({ where: { id: body.model } });
      if (!model || !model.enabled) {
        throw new ApiError(
          404,
          "model_not_found",
          `Model "${body.model}" does not exist. See GET /v1/models.`,
        );
      }
      if (!tierAllows(principal.tier, model.minTier)) {
        throw new ApiError(
          403,
          "model_not_in_tier",
          `"${model.id}" needs the ${ctx.tiers[model.minTier].label} tier. Your key is ${ctx.tiers[principal.tier].label}.`,
        );
      }
      const policy = ctx.tiers[principal.tier];

      // Build the upstream body: same request, mapped model id, clamped output length.
      const upstream: Record<string, unknown> = { ...body, model: model.openrouterId };
      for (const f of STRIPPED_FIELDS) delete upstream[f];
      if (policy.maxTokens !== null) {
        const cap = policy.maxTokens;
        if (body.max_completion_tokens != null) {
          upstream.max_completion_tokens = Math.min(body.max_completion_tokens, cap);
          if (body.max_tokens != null) upstream.max_tokens = Math.min(body.max_tokens, cap);
        } else {
          upstream.max_tokens = Math.min(body.max_tokens ?? cap, cap);
        }
      }
      upstream.usage = { include: true };
      const stream = body.stream === true;
      const clientWantsUsage = body.stream_options?.include_usage === true;

      // Budget: reserve the worst case. Free tiers stop at the daily cap.
      const promptPrice = Number(model.promptPrice);
      const completionPrice = Number(model.completionPrice);
      const inputEstimate = estimateTokens(
        JSON.stringify(body.messages).length + JSON.stringify(body.tools ?? []).length,
      );
      const outputCeiling =
        (upstream.max_completion_tokens as number | undefined) ??
        (upstream.max_tokens as number | undefined) ??
        DEFAULT_OUTPUT_ESTIMATE;
      const reservation = await ctx.budget.reserve(
        tokensCostMicro(inputEstimate, outputCeiling, promptPrice, completionPrice),
        policy.free,
      );
      if (isRefusal(reservation)) {
        if (reservation.refused === "busy") {
          throw new ApiError(
            429,
            "budget_busy",
            "Free capacity is fully in use right now. Retry in a few seconds.",
            { "retry-after": BUSY_RETRY_SECONDS },
          );
        }
        await alertBudgetOnce(app);
        const retry = secondsUntilUtcMidnight(ctx.clock());
        throw new ApiError(
          429,
          "budget_exhausted",
          "The free daily budget has been used up. Free access resumes at 00:00 UTC.",
          { "retry-after": retry },
        );
      }

      // Builder wallets pay from prepaid credit: reserve the worst-case charge (cost × markup).
      const charged = principal.tierSource === "credits";
      const creditReserve = charged
        ? ctx.credits.charge(tokensCostMicro(inputEstimate, outputCeiling, promptPrice, completionPrice))
        : 0;
      if (charged && !(await ctx.credits.reserve(principal.walletId, creditReserve))) {
        await ctx.budget.settle(reservation, 0);
        await ctx.auth.bustWallet(principal.walletId);
        throw new ApiError(
          402,
          "insufficient_credits",
          `Not enough credit for this request (up to $${(creditReserve / 1e6).toFixed(4)}). Top up, or lower max_tokens.`,
        );
      }
      const settleCredits = async (actualCostMicro: number) => {
        if (!charged) return 0;
        const actual = ctx.credits.charge(actualCostMicro);
        await ctx.credits.settle(principal.walletId, creditReserve, actual);
        if ((await ctx.credits.balance(principal.walletId)) <= 0n)
          await ctx.auth.bustWallet(principal.walletId);
        return actual;
      };

      // Daily quota per wallet.
      const quota = await ctx.quota.consume(principal.walletAddress, policy.dailyRequests);
      if (!quota.ok) {
        await ctx.budget.settle(reservation, 0);
        await settleCredits(0);
        throw new ApiError(
          429,
          "quota_exceeded",
          `Daily allowance used up (${policy.dailyRequests} requests for ${policy.label}). It resets at 00:00 UTC.`,
          { "retry-after": secondsUntilUtcMidnight(ctx.clock()), "x-dualyne-remaining": 0 },
        );
      }
      if (quota.remaining !== null) reply.header("x-dualyne-remaining", quota.remaining);

      const base = {
        source: "api" as const,
        apiKeyId: principal.keyId,
        walletId: principal.walletId,
        walletAddress: principal.walletAddress,
        modelId: model.id,
        openrouterId: model.openrouterId,
        stream,
      };

      // Call OpenRouter. Abort it if the client disconnects.
      const ac = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableFinished) ac.abort();
      };
      reply.raw.on("close", onClose);
      const headersTimer = setTimeout(() => ac.abort(), UPSTREAM_HEADERS_TIMEOUT_MS);

      let res: Response;
      try {
        res = await ctx.openrouter.chat(upstream, ac.signal);
      } catch (err) {
        clearTimeout(headersTimer);
        reply.raw.off("close", onClose);
        await ctx.quota.refund(quota.key);
        await ctx.budget.settle(reservation, 0);
        await settleCredits(0);
        const cancelled = ac.signal.aborted && reply.raw.destroyed;
        req.log.warn({ err, model: model.id }, "upstream request failed");
        await logUsage(ctx.prisma, req.log, {
          ...base,
          inputTokens: 0,
          outputTokens: 0,
          costMicroUsd: 0,
          latencyMs: Date.now() - startedAt,
          status: cancelled ? 499 : 502,
          errorCode: cancelled ? "cancelled" : "upstream_unreachable",
        });
        throw providerFailed();
      }
      clearTimeout(headersTimer);

      if (!res.ok) {
        reply.raw.off("close", onClose);
        const text = await res.text().catch(() => "");
        await ctx.quota.refund(quota.key);
        await ctx.budget.settle(reservation, 0);
        await settleCredits(0);
        if (quota.remaining !== null) reply.header("x-dualyne-remaining", quota.remaining + 1);
        const upstreamMessage = parseUpstreamError(text);
        req.log.warn({ status: res.status, model: model.id, upstreamMessage }, "upstream returned an error");
        if (res.status === 402) {
          void ctx.alert("OpenRouter returned 402: the OpenRouter account is out of credits.");
        }
        const clientError = res.status === 400 || res.status === 422;
        await logUsage(ctx.prisma, req.log, {
          ...base,
          inputTokens: 0,
          outputTokens: 0,
          costMicroUsd: 0,
          latencyMs: Date.now() - startedAt,
          status: clientError ? 400 : 502,
          errorCode: `upstream_${res.status}`,
        });
        if (clientError) {
          throw new ApiError(
            400,
            "invalid_request",
            upstreamMessage ?? "The model provider rejected the request.",
          );
        }
        throw providerFailed();
      }

      const finish = async (
        inspector: StreamInspector | null,
        usage: UsageInfo | null,
        generationId: string | null,
        status: number,
        errorCode: string | null,
      ) => {
        reply.raw.off("close", onClose);
        const inputTokens = usage?.promptTokens ?? inputEstimate;
        const outputTokens = usage?.completionTokens ?? estimateTokens(inspector?.outputChars ?? 0);
        const costMicro =
          usage?.costUsd != null
            ? usdToMicro(usage.costUsd)
            : tokensCostMicro(inputTokens, outputTokens, promptPrice, completionPrice);
        await ctx.budget.settle(reservation, costMicro);
        const chargedMicro = await settleCredits(costMicro);
        await logUsage(ctx.prisma, req.log, {
          ...base,
          chargedMicroUsd: chargedMicro,
          generationId,
          inputTokens,
          outputTokens,
          costMicroUsd: costMicro,
          latencyMs: Date.now() - startedAt,
          ttftMs: inspector?.firstTokenAt != null ? inspector.firstTokenAt - startedAt : null,
          status,
          errorCode,
        });
        void ctx.prisma.apiKey
          .update({ where: { id: principal.keyId }, data: { lastUsedAt: new Date() } })
          .catch(() => undefined);
      };

      if (!stream) {
        const text = await res.text();
        let usage: UsageInfo | null = null;
        let generationId: string | null = null;
        try {
          const json = JSON.parse(text) as { id?: unknown };
          usage = readUsage(json as Parameters<typeof readUsage>[0]);
          if (typeof json.id === "string") generationId = json.id;
        } catch {
          // Not JSON: still pass it through unchanged.
        }
        await finish(null, usage, generationId, 200, null);
        return reply.status(200).header("content-type", "application/json").send(text);
      }

      const streaming = streamThrough(reply, res, clientWantsUsage, finish);
      ctx.track(streaming);
      return streaming;
    },
  );
};

async function streamThrough(
  reply: FastifyReply,
  res: Response,
  clientWantsUsage: boolean,
  finish: (
    inspector: StreamInspector,
    usage: UsageInfo | null,
    generationId: string | null,
    status: number,
    errorCode: string | null,
  ) => Promise<void>,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { ...plainHeaders(reply.getHeaders()), ...SSE_HEADERS });
  raw.flushHeaders();

  const inspector = new StreamInspector();
  let errorCode: string | null = null;
  try {
    for await (const event of readEvents(res)) {
      if (inspector.inspect(event, clientWantsUsage) === "drop") continue;
      if (!(await writeRaw(raw, event))) {
        errorCode = "cancelled";
        break;
      }
    }
  } catch {
    errorCode = raw.destroyed ? "cancelled" : "stream_interrupted";
  }
  if (!raw.writableEnded) raw.end();
  await finish(
    inspector,
    inspector.usage,
    inspector.generationId,
    errorCode === "cancelled" ? 499 : 200,
    errorCode ?? inspector.errorCode,
  );
}

function providerFailed(): ApiError {
  return new ApiError(502, "upstream_error", "The model provider failed. Retry once, or switch models.");
}

function parseUpstreamError(text: string): string | null {
  try {
    const json = JSON.parse(text) as { error?: { message?: unknown } };
    const msg = json.error?.message;
    return typeof msg === "string" && msg.length ? msg.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** Send one alert per UTC day when the budget cap first refuses a request. */
export async function alertBudgetOnce(app: { ctx: AppContext }): Promise<void> {
  const { ctx } = app;
  const key = `alert:budget:${ctx.clock().toISOString().slice(0, 10)}`;
  const first = await ctx.redis.set(key, "1", "EX", 172_800, "NX");
  if (first)
    void ctx.alert(
      `Daily budget cap of $${ctx.env.DAILY_BUDGET_USD} reached. Free tiers now get 429 until 00:00 UTC.`,
    );
}
