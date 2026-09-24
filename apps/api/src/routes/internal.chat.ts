import { chatRequestSchema, type ChatEvents } from "@dualyne/shared";
import type { FastifyPluginAsync } from "fastify";
import { isRefusal } from "../budget";
import { ApiError } from "../lib/errors";
import { plainHeaders, SSE_HEADERS, writeRaw } from "../lib/http";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { secondsUntilUtcMidnight } from "../lib/time";
import { readEvents, StreamInspector } from "../openrouter/sse";
import { verifyTurnstile } from "../turnstile";
import { logUsage } from "../usage/log";
import { alertBudgetOnce, assertModelsLive, BUSY_RETRY_SECONDS } from "./v1.chat";

const PING_INTERVAL_MS = 15_000;
const TURNSTILE_ACTION = "chat";

/**
 * The website's Chat page: one free (explorer-tier) model, a short conversation, streamed back.
 * Same protections as Compare: optional Turnstile, a per-IP hourly limit, the daily budget and a
 * fixed max_tokens. The conversation lives in the visitor's browser; the server keeps no text.
 */
export const freeChatRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { env } = ctx;

  app.post(
    "/internal/chat",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } }, bodyLimit: 128 * 1024 },
    async (req, reply) => {
      assertModelsLive(ctx, "Chat opens soon. Come back in a little while.");
      const body = chatRequestSchema.parse(req.body);

      const model = await ctx.prisma.model.findUnique({ where: { id: body.model } });
      if (!model || !model.enabled) {
        throw new ApiError(404, "model_not_found", "That model is not in the catalog.");
      }
      if (model.minTier !== "explorer") {
        throw new ApiError(
          403,
          "model_not_allowed",
          `${model.name} is for token holders. Pick one of the free models.`,
        );
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
      const slot = await ctx.chatLimiter.hit(ipHash);
      if (!slot.allowed) {
        throw new ApiError(
          429,
          "rate_limited",
          `You've sent your ${env.CHAT_LIMIT_PER_HOUR} free messages for this hour.`,
          { "retry-after": slot.retryAfterSeconds, "x-chat-remaining": 0 },
        );
      }

      const inputTokens = estimateTokens(body.messages.reduce((n, m) => n + m.content.length, 0));
      const reservation = await ctx.budget.reserve(
        tokensCostMicro(
          inputTokens,
          env.COMPARE_MAX_TOKENS,
          Number(model.promptPrice),
          Number(model.completionPrice),
        ),
        true,
      );
      if (isRefusal(reservation)) {
        await slot.release();
        if (reservation.refused === "busy") {
          throw new ApiError(
            429,
            "budget_busy",
            "Lots of people are chatting right now. Try again in a few seconds.",
            { "retry-after": BUSY_RETRY_SECONDS },
          );
        }
        await alertBudgetOnce(app);
        throw budgetExhausted(ctx.clock());
      }
      reply.header("x-chat-remaining", slot.remaining);

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { ...plainHeaders(reply.getHeaders()), ...SSE_HEADERS });
      raw.flushHeaders();

      const send = <E extends keyof ChatEvents>(event: E, data: ChatEvents[E]) =>
        writeRaw(raw, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const ac = new AbortController();
      raw.on("close", () => {
        if (!raw.writableFinished) ac.abort();
      });
      const ping = setInterval(() => void writeRaw(raw, ": ping\n\n"), PING_INTERVAL_MS);
      await send("meta", { model: model.id });

      const startedAt = Date.now();
      const inspector = new StreamInspector();
      let status = 200;
      let errorCode: string | null = null;
      let completed = false;
      try {
        const res = await ctx.openrouter.chat(
          {
            model: model.openrouterId,
            messages: body.messages,
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
            if (inspector.lastDelta) await send("delta", { text: inspector.lastDelta });
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
      } finally {
        clearInterval(ping);
      }

      const u = inspector.usage;
      const inTok = u?.promptTokens ?? inputTokens;
      const outTok = u?.completionTokens ?? estimateTokens(inspector.outputChars);
      const costMicro =
        u?.costUsd != null
          ? usdToMicro(u.costUsd)
          : tokensCostMicro(inTok, outTok, Number(model.promptPrice), Number(model.completionPrice));
      const totalMs = Date.now() - startedAt;

      if (completed) await send("done", { outputTokens: outTok, totalMs });
      else if (status !== 499) await send("error", { code: "upstream_failed" });

      await ctx.budget.settle(reservation, costMicro);
      await logUsage(ctx.prisma, req.log, {
        createdAt: ctx.clock(),
        source: "chat",
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
      });
      await send("end", {});
      if (!raw.writableEnded) raw.end();
    },
  );
};

function budgetExhausted(now: Date): ApiError {
  return new ApiError(429, "budget_exhausted", "Free chat is paused for today. It comes back at 00:00 UTC.", {
    "retry-after": secondsUntilUtcMidnight(now),
  });
}
