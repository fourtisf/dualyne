import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { ZodError } from "zod";
import { ApiKeyAuth, bearerToken } from "./auth/apiKey";
import { Sessions } from "./auth/sessions";
import type { ChainReader } from "./chain/types";
import { ViemChain } from "./chain/viem";
import { SybilCheck } from "./sybil";
import { TierService } from "./tierService";
import { Credits } from "./credits";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { treasuryRoutes } from "./routes/treasury";
import { creditRoutes } from "./routes/credits";
import { voteRoutes } from "./routes/votes";
import { shareRoutes } from "./routes/shares";
import { Budget } from "./budget";
import type { AppContext } from "./context";
import { webOrigins, type Env } from "./env";
import { createAlerter } from "./lib/alert";
import { ApiError, errorBody } from "./lib/errors";
import { hashIp, sha256Hex } from "./lib/hash";
import { usdToMicro } from "./lib/money";
import { systemClock, type Clock } from "./lib/time";
import { SlidingWindowLimiter } from "./limiter";
import { OpenRouter } from "./openrouter/client";
import { Quota } from "./quota";
import { tierPolicies } from "./tiers";
import { chatRoutes } from "./routes/v1.chat";
import { modelsRoutes } from "./routes/v1.models";
import { compareRoutes } from "./routes/internal.compare";
import { freeChatRoutes } from "./routes/internal.chat";
import { catalogRoutes } from "./routes/internal.catalog";
import { pageViewRoutes } from "./routes/internal.pv";
import { chatShareRoutes } from "./routes/chatShares";
import { proRoutes } from "./routes/pro";
import { healthRoutes } from "./routes/health";
import { statusRoutes } from "./routes/status";

export interface BuildOptions {
  env: Env;
  prisma?: PrismaClient;
  redis?: Redis;
  clock?: Clock;
  /** Override the chain reader (tests). Defaults to viem when RPC_URL is set. */
  chain?: ChainReader | null;
}

/** Paths called from the website with the session cookie: CORS limited to our own origins. */
const CREDENTIALED_PREFIXES = ["/internal/compare", "/internal/chat", "/auth/", "/me", "/votes"];

export const EXPOSED_HEADERS = [
  "x-request-id",
  "x-dualyne-remaining",
  "x-compare-remaining",
  "x-chat-remaining",
  "retry-after",
];

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { env } = opts;
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
    logger:
      env.LOG_LEVEL === "silent"
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: ["req.headers.authorization", "req.headers.cookie", "headers.authorization"],
              censor: "[redacted]",
            },
            // Keep IPs and request bodies out of the logs.
            serializers: {
              req: (req: { method: string; url: string; id: string }) => ({
                method: req.method,
                url: req.url.split("?")[0],
                id: req.id,
              }),
            },
          },
  });

  const ownPrisma = !opts.prisma;
  const ownRedis = !opts.redis;
  const prisma = opts.prisma ?? new PrismaClient();
  const redis =
    opts.redis ?? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableAutoPipelining: true });
  const clock = opts.clock ?? systemClock;
  const chain =
    opts.chain !== undefined
      ? opts.chain
      : env.RPC_URL
        ? new ViemChain({
            rpcUrl: env.RPC_URL,
            chainId: env.SIWE_CHAIN_ID,
            explorerApiUrl: env.EXPLORER_API_URL,
            explorerApiKey: env.EXPLORER_API_KEY,
          })
        : null;
  const creditsEnabled = Boolean(
    chain &&
      env.DEPOSIT_ADDRESS &&
      (env.USDG_TOKEN_ADDRESS || env.STABLECOINS.length || env.ETH_USD_FEED_ADDRESS),
  );
  const tierService = new TierService(prisma, redis, chain, {
    dlynToken: env.DLYN_TOKEN_ADDRESS as `0x${string}` | undefined,
    holderMin: env.HOLDER_MIN_DLYN,
    credits: creditsEnabled,
  });

  const ctx: AppContext = {
    env,
    prisma,
    redis,
    clock,
    quota: new Quota(redis, clock),
    budget: new Budget(redis, prisma, usdToMicro(env.DAILY_BUDGET_USD), clock),
    auth: new ApiKeyAuth(prisma, redis, tierService),
    openrouter: new OpenRouter({
      baseUrl: env.OPENROUTER_BASE_URL,
      apiKey: env.OPENROUTER_API_KEY,
      appUrl: `https://${env.SITE_DOMAIN}`,
      appTitle: env.OPENROUTER_APP_TITLE,
    }),
    tiers: tierPolicies(env),
    compareLimiter: new SlidingWindowLimiter(redis, "cmp", env.COMPARE_LIMIT_PER_HOUR, 3_600_000, clock),
    chatLimiter: new SlidingWindowLimiter(redis, "chatd", env.CHAT_LIMIT_PER_DAY, 86_400_000, clock),
    proChatLimiter: new SlidingWindowLimiter(redis, "prochat", env.PRO_CHAT_PER_DAY, 86_400_000, clock),
    proPremiumLimiter: new SlidingWindowLimiter(
      redis,
      "propremium",
      env.PRO_PREMIUM_PER_DAY,
      86_400_000,
      clock,
    ),
    webFreeLimiter: new SlidingWindowLimiter(redis, "webf", env.WEB_SEARCH_FREE_PER_DAY, 86_400_000, clock),
    webProLimiter: new SlidingWindowLimiter(redis, "webp", env.WEB_SEARCH_PRO_PER_DAY, 86_400_000, clock),
    alert: createAlerter(app.log, {
      webhookUrl: env.ALERT_WEBHOOK_URL,
      telegram:
        env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
          ? { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, apiUrl: env.TELEGRAM_API_URL }
          : undefined,
    }),
    ipHash: (ip) => hashIp(env.IP_HASH_SECRET, ip),
    chain,
    sessions: new Sessions(prisma, env.SESSION_SECRET, clock),
    tierService,
    credits: new Credits(prisma, env.BUILDER_MARKUP, creditsEnabled),
    sybil: new SybilCheck(
      redis,
      chain,
      {
        enabled: env.SYBIL_CHECK === "on" || (env.SYBIL_CHECK === "auto" && chain !== null),
        minWei: env.SYBIL_MIN_ETH_WEI,
        minAgeDays: env.SYBIL_MIN_WALLET_AGE_DAYS,
      },
      clock,
    ),
    inflight: new Set(),
    track: (p) => {
      const tracked = p.catch(() => undefined).finally(() => ctx.inflight.delete(tracked));
      ctx.inflight.add(tracked);
    },
  };
  app.decorate("ctx", ctx);

  app.addHook("onClose", async () => {
    await Promise.all([...ctx.inflight]);
    if (ownPrisma) await prisma.$disconnect();
    if (ownRedis) await redis.quit();
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
    reply.header("x-content-type-options", "nosniff");
  });

  const allowedOrigins = webOrigins(env);
  await app.register(cookie);
  await app.register(cors, {
    delegator: (req, cb) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      if (CREDENTIALED_PREFIXES.some((p) => path.startsWith(p))) {
        cb(null, {
          origin: allowedOrigins,
          credentials: true,
          methods: ["GET", "POST", "DELETE"],
          allowedHeaders: ["content-type"],
          exposedHeaders: EXPOSED_HEADERS,
          maxAge: 600,
        });
      } else {
        cb(null, {
          origin: "*",
          methods: ["GET", "POST", "DELETE"],
          allowedHeaders: ["authorization", "content-type"],
          exposedHeaders: EXPOSED_HEADERS,
          maxAge: 600,
        });
      }
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: 60_000,
    redis,
    nameSpace: "rl:",
    skipOnError: false,
    keyGenerator: (req) => `ip:${ctx.ipHash(req.ip)}`,
    errorResponseBuilder: (_req, context) =>
      new ApiError(
        429,
        "rate_limited",
        `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        { "retry-after": Math.ceil(context.ttl / 1000) },
      ),
  });

  app.setErrorHandler((err: FastifyError | ApiError | ZodError, req, reply) => {
    if (err instanceof ApiError) {
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
      return reply.status(err.statusCode).send(errorBody(err.statusCode, err.code, err.message));
    }
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return reply
        .status(400)
        .send(errorBody(400, "invalid_request", `${where}${issue?.message ?? "Invalid body"}`));
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      return reply.status(500).send(errorBody(500, "internal_error", "Something went wrong on our side."));
    }
    if (status === 413)
      return reply.status(413).send(errorBody(413, "body_too_large", "Request body is too large."));
    return reply
      .status(status)
      .send(errorBody(status, (err as FastifyError).code ?? "bad_request", err.message));
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send(errorBody(404, "not_found", `No route for ${req.method} ${req.url.split("?")[0]}`)),
  );

  // Per-key limit for the OpenAI-compatible API (in addition to the per-IP limit).
  const keyLimit = {
    rateLimit: {
      max: 120,
      timeWindow: 60_000,
      keyGenerator: (req: { headers: Record<string, unknown>; ip: string }) => {
        const token = bearerToken(req.headers.authorization as string | undefined);
        return token ? `key:${sha256Hex(token)}` : `ip:${ctx.ipHash(req.ip)}`;
      },
    },
  };

  await app.register(healthRoutes);
  await app.register(statusRoutes);
  await app.register(catalogRoutes);
  await app.register(modelsRoutes, { routeConfig: keyLimit });
  await app.register(chatRoutes, { routeConfig: keyLimit });
  await app.register(compareRoutes);
  await app.register(freeChatRoutes);
  await app.register(pageViewRoutes);
  await app.register(chatShareRoutes);
  await app.register(proRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(treasuryRoutes);
  await app.register(creditRoutes);
  await app.register(voteRoutes);
  await app.register(shareRoutes);

  return app;
}
