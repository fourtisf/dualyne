import { chatRequestSchema, type ChatEvents, type ChatQuota } from "@dualyne/shared";
import type { FastifyPluginAsync } from "fastify";
import { SESSION_COOKIE } from "../auth/sessions";
import { isRefusal } from "../budget";
import { ApiError } from "../lib/errors";
import { plainHeaders, SSE_HEADERS, writeRaw } from "../lib/http";
import { estimateTokens, tokensCostMicro, usdToMicro } from "../lib/money";
import { secondsUntilUtcMidnight } from "../lib/time";
import { readEvents, StreamInspector } from "../openrouter/sse";
import { verifyTurnstile } from "../turnstile";
import { isPro, premiumSpendMicro } from "../pro";
import { logUsage } from "../usage/log";
import { rememberAnswer } from "./chatShares";
import { alertBudgetOnce, alertOutOfCredits, assertModelsLive, BUSY_RETRY_SECONDS } from "./v1.chat";

const PING_INTERVAL_MS = 15_000;
const TURNSTILE_ACTION = "chat";

/**
 * The website's Chat page: one model, a short conversation, streamed back.
 * Free plan: the free (explorer) models, CHAT_LIMIT_PER_DAY per person, paused when the day's free
 * budget is spent. Pro plan (signed-in wallet with proUntil in the future): every model,
 * PRO_CHAT_PER_DAY messages of which PRO_PREMIUM_PER_DAY on premium models, a fair-use cap on
 * premium cost, and longer answers. The conversation lives in the browser; the server keeps no text.
 */
export const freeChatRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { env } = ctx;

  /** The caller's plan and messages left today, without using one. */
  app.get(
    "/internal/chat/quota",
    { config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      const wallet = await ctx.sessions.get(req.cookies[SESSION_COOKIE]);
      if (wallet && isPro(wallet, ctx.clock())) {
        const [remaining, premiumRemaining] = await Promise.all([
          ctx.proChatLimiter.remaining(wallet.id),
          ctx.proPremiumLimiter.remaining(wallet.id),
        ]);
        const body: ChatQuota = {
          plan: "pro",
          limit: env.PRO_CHAT_PER_DAY,
          remaining,
          premiumLimit: env.PRO_PREMIUM_PER_DAY,
          premiumRemaining,
          proUntil: wallet.proUntil!.toISOString(),
        };
        return body;
      }
      const body: ChatQuota = {
        plan: "free",
        limit: env.CHAT_LIMIT_PER_DAY,
        remaining: await ctx.chatLimiter.remaining(ctx.ipHash(req.ip)),
      };
      return body;
    },
  );

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
      const wallet = await ctx.sessions.get(req.cookies[SESSION_COOKIE]);
      const pro = wallet && isPro(wallet, ctx.clock()) ? wallet : null;
      const premium = model.minTier !== "explorer";
      if (premium && !pro) {
        throw new ApiError(
          403,
          "model_not_allowed",
          `${model.name} is part of Pro. Pick a free model, or upgrade.`,
        );
      }

      // Pro users paid, so the free plan's daily budget doesn't stop them.
      if (!pro && (await ctx.budget.isExhausted())) {
        await alertBudgetOnce(app);
        throw budgetExhausted(ctx.clock());
      }

      if (env.TURNSTILE_SECRET_KEY && !pro) {
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
      const slots: { release(): Promise<void> }[] = [];
      const releaseAll = () => Promise.all(slots.map((s) => s.release()));
      let remaining: number;
      if (pro) {
        const slot = await ctx.proChatLimiter.hit(pro.id);
        if (!slot.allowed) {
          throw new ApiError(
            429,
            "rate_limited",
            `You've sent your ${env.PRO_CHAT_PER_DAY} messages for today.`,
            {
              "retry-after": slot.retryAfterSeconds,
              "x-chat-remaining": 0,
            },
          );
        }
        slots.push(slot);
        remaining = slot.remaining;
        if (premium) {
          const p = await ctx.proPremiumLimiter.hit(pro.id);
          if (!p.allowed) {
            await releaseAll();
            throw new ApiError(
              429,
              "premium_limit",
              `You've used your ${env.PRO_PREMIUM_PER_DAY} premium messages for today. The free models still work.`,
              { "retry-after": p.retryAfterSeconds },
            );
          }
          slots.push(p);
          if ((await premiumSpendMicro(ctx, pro.id)) >= env.PRO_FAIR_USE_USD * 1e6) {
            await releaseAll();
            throw new ApiError(
              429,
              "fair_use",
              "You've reached this month's fair use of premium models. The free models still work.",
            );
          }
        }
      } else {
        const slot = await ctx.chatLimiter.hit(ipHash);
        if (!slot.allowed) {
          throw new ApiError(
            429,
            "rate_limited",
            `You've sent your ${env.CHAT_LIMIT_PER_DAY} free messages for today.`,
            { "retry-after": slot.retryAfterSeconds, "x-chat-remaining": 0 },
          );
        }
        slots.push(slot);
        remaining = slot.remaining;
      }

      const maxTokens = pro ? env.PRO_MAX_TOKENS : env.COMPARE_MAX_TOKENS;
      const inputTokens = estimateTokens(body.messages.reduce((n, m) => n + m.content.length, 0));
      const reservation = await ctx.budget.reserve(
        tokensCostMicro(inputTokens, maxTokens, Number(model.promptPrice), Number(model.completionPrice)),
        !pro,
      );
      if (isRefusal(reservation)) {
        await releaseAll();
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
      reply.header("x-chat-remaining", remaining);

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
      let full = "";
      let status = 200;
      let errorCode: string | null = null;
      let completed = false;
      try {
        const res = await ctx.openrouter.chat(
          {
            model: model.openrouterId,
            messages: body.messages,
            max_tokens: maxTokens,
            stream: true,
            usage: { include: true },
          },
          ac.signal,
        );
        if (!res.ok) {
          await res.text().catch(() => "");
          if (res.status === 402) void alertOutOfCredits(ctx);
          status = 502;
          errorCode = `upstream_${res.status}`;
        } else {
          for await (const event of readEvents(res)) {
            inspector.inspect(event, true);
            if (inspector.lastDelta) {
              full += inspector.lastDelta;
              await send("delta", { text: inspector.lastDelta });
            }
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

      if (completed) {
        // A fingerprint (not the text) so this visitor can share the answer later.
        await rememberAnswer(ctx.redis, ipHash, full);
        await send("done", { outputTokens: outTok, totalMs });
      } else if (status !== 499) await send("error", { code: "upstream_failed" });

      await ctx.budget.settle(reservation, costMicro);
      await logUsage(ctx.prisma, req.log, {
        createdAt: ctx.clock(),
        source: "chat",
        walletId: pro?.id ?? null,
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
