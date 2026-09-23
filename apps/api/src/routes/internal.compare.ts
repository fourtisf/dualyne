import type { Model } from "@prisma/client";
import { compareRequestSchema, type CompareEvents, type Lane } from "@refract/shared";
import type { FastifyPluginAsync } from "fastify";
import type { Reservation } from "../budget";
import { ApiError } from "../lib/errors";
import { plainHeaders, SSE_HEADERS, writeRaw } from "../lib/http";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { secondsUntilUtcMidnight } from "../lib/time";
import { readEvents, StreamInspector } from "../openrouter/sse";
import { verifyTurnstile } from "../turnstile";
import { logUsage } from "../usage/log";
import { alertBudgetOnce } from "./v1.chat";
import { pickTwo } from "./votes";

const PING_INTERVAL_MS = 15_000;
const TURNSTILE_ACTION = "compare";

/**
 * The website's Compare tool. One request = one comparison run: both models stream back
 * over a single SSE response, each event tagged with its lane.
 * Protected by Turnstile, a per-IP hourly limit, explorer-tier models only, and a fixed max_tokens.
 */
export const compareRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { env } = ctx;

  app.post(
    "/internal/compare",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } }, bodyLimit: 64 * 1024 },
    async (req, reply) => {
      const body = compareRequestSchema.parse(req.body);

      const blind = body.blind === true || ctx.env.COMPARE_BLIND_MODE === "always";
      let modelA: Model | undefined;
      let modelB: Model | undefined;
      if (blind) {
        // The server picks two different free models and hides them until the vote.
        const free = await ctx.prisma.model.findMany({
          where: { enabled: true, minTier: "explorer", missingSince: null },
        });
        if (free.length < 2)
          throw new ApiError(503, "unavailable", "Blind comparisons are not available right now.");
        [modelA, modelB] = pickTwo(free);
      } else {
        const models = await ctx.prisma.model.findMany({
          where: { id: { in: [body.a!, body.b!] }, enabled: true },
        });
        const byId = new Map(models.map((m) => [m.id, m]));
        modelA = byId.get(body.a!);
        modelB = byId.get(body.b!);
        if (!modelA || !modelB)
          throw new ApiError(404, "model_not_found", "That model is not in the catalog.");
        for (const m of [modelA, modelB]) {
          if (m.minTier !== "explorer") {
            throw new ApiError(
              403,
              "model_not_allowed",
              `${m.name} is not available in free comparisons. Use it through the API with a Holder key.`,
            );
          }
        }
      }

      if (await ctx.budget.isExhausted()) {
        await alertBudgetOnce(app);
        throw budgetExhausted(ctx.clock());
      }

      if (env.TURNSTILE_SECRET_KEY) {
        const passed = await verifyTurnstile(
          {
            secret: env.TURNSTILE_SECRET_KEY,
            verifyUrl: env.TURNSTILE_VERIFY_URL,
            hostnames: env.NODE_ENV === "production" ? [env.SITE_DOMAIN, `www.${env.SITE_DOMAIN}`] : [],
            action: TURNSTILE_ACTION,
          },
          body.turnstileToken,
          req.ip,
        );
        if (!passed) {
          throw new ApiError(
            403,
            "turnstile_failed",
            "We couldn't verify this browser. Reload the page and try again.",
          );
        }
      }

      const ipHash = ctx.ipHash(req.ip);
      const slot = await ctx.compareLimiter.hit(ipHash);
      if (!slot.allowed) {
        throw new ApiError(
          429,
          "rate_limited",
          `You've used your ${env.COMPARE_LIMIT_PER_HOUR} free comparisons for this hour.`,
          { "retry-after": slot.retryAfterSeconds, "x-compare-remaining": 0 },
        );
      }

      // Reserve the worst-case cost of both lanes against the daily budget.
      const inputTokens = estimateTokens(body.prompt.length);
      const reserve = (m: Model) =>
        ctx.budget.reserve(
          tokensCostMicro(
            inputTokens,
            env.COMPARE_MAX_TOKENS,
            Number(m.promptPrice),
            Number(m.completionPrice),
          ),
          true,
        );
      const resA = await reserve(modelA);
      const resB = resA ? await reserve(modelB) : null;
      if (!resA || !resB) {
        if (resA) await ctx.budget.settle(resA, 0);
        await slot.release();
        await alertBudgetOnce(app);
        throw budgetExhausted(ctx.clock());
      }
      reply.header("x-compare-remaining", slot.remaining);

      const run = await ctx.prisma.compareRun.create({
        data: { modelA: modelA.id, modelB: modelB.id, ipHash, blind },
      });

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { ...plainHeaders(reply.getHeaders()), ...SSE_HEADERS });
      raw.flushHeaders();

      const send = <E extends keyof CompareEvents>(event: E, data: CompareEvents[E]) =>
        writeRaw(raw, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const ac = new AbortController();
      raw.on("close", () => {
        if (!raw.writableFinished) ac.abort();
      });
      const ping = setInterval(() => void writeRaw(raw, ": ping\n\n"), PING_INTERVAL_MS);

      await send("meta", {
        compareId: run.id,
        a: blind ? null : modelA.id,
        b: blind ? null : modelB.id,
        blind,
      });

      const lane = async (L: Lane, model: Model, reservation: Reservation) => {
        const startedAt = Date.now();
        const inspector = new StreamInspector();
        let status = 200;
        let errorCode: string | null = null;
        let completed = false;
        try {
          const res = await ctx.openrouter.chat(
            {
              model: model.openrouterId,
              messages: [{ role: "user", content: body.prompt }],
              max_tokens: env.COMPARE_MAX_TOKENS,
              stream: true,
              usage: { include: true },
            },
            ac.signal,
          );
          if (!res.ok) {
            await res.text().catch(() => "");
            if (res.status === 402)
              void ctx.alert("OpenRouter returned 402: the OpenRouter account is out of credits.");
            status = 502;
            errorCode = `upstream_${res.status}`;
          } else {
            for await (const event of readEvents(res)) {
              inspector.inspect(event, true);
              if (inspector.lastDelta) await send("delta", { lane: L, text: inspector.lastDelta });
            }
            if (inspector.errorCode) {
              status = 502;
              errorCode = inspector.errorCode;
            } else {
              completed = true;
            }
          }
        } catch {
          if (ac.signal.aborted) {
            status = 499;
            errorCode = "cancelled";
          } else {
            status = 502;
            errorCode = "stream_interrupted";
          }
        }

        const u = inspector.usage;
        const inTok = u?.promptTokens ?? inputTokens;
        const outTok = u?.completionTokens ?? estimateTokens(inspector.outputChars);
        const costMicro =
          u?.costUsd != null
            ? usdToMicro(u.costUsd)
            : tokensCostMicro(inTok, outTok, Number(model.promptPrice), Number(model.completionPrice));
        const totalMs = Date.now() - startedAt;

        if (completed) {
          await send("done", {
            lane: L,
            ttftMs: inspector.firstTokenAt != null ? inspector.firstTokenAt - startedAt : null,
            totalMs,
            outputTokens: outTok,
            costUsd: costMicro / 1_000_000,
          });
        } else if (status !== 499) {
          await send("error", { lane: L, code: "upstream_failed" });
        }

        await ctx.budget.settle(reservation, costMicro);
        await logUsage(ctx.prisma, req.log, {
          source: "compare",
          modelId: model.id,
          openrouterId: model.openrouterId,
          generationId: inspector.generationId,
          inputTokens: inTok,
          outputTokens: outTok,
          costMicroUsd: costMicro,
          latencyMs: totalMs,
          ttftMs: inspector.firstTokenAt != null ? inspector.firstTokenAt - startedAt : null,
          status,
          errorCode,
          stream: true,
          ipHash,
          compareId: run.id,
        });
        if (completed) {
          await ctx.prisma.compareRun
            .update({ where: { id: run.id }, data: L === "a" ? { completedA: true } : { completedB: true } })
            .catch((err: unknown) => req.log.error({ err }, "failed to mark compare lane complete"));
        }
      };

      try {
        await Promise.all([lane("a", modelA, resA), lane("b", modelB, resB)]);
      } finally {
        clearInterval(ping);
      }
      await send("end", {});
      if (!raw.writableEnded) raw.end();
    },
  );
};

function budgetExhausted(now: Date): ApiError {
  return new ApiError(
    429,
    "budget_exhausted",
    "Free comparisons are paused for today. They come back at 00:00 UTC.",
    { "retry-after": secondsUntilUtcMidnight(now) },
  );
}
