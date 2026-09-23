import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { ZodError } from "zod";
import { ApiKeyAuth, bearerToken } from "./auth/apiKey";
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
import { catalogRoutes } from "./routes/internal.catalog";
import { healthRoutes } from "./routes/health";

export interface BuildOptions {
  env: Env;
  prisma?: PrismaClient;
  redis?: Redis;
  clock?: Clock;
}

export const EXPOSED_HEADERS = ["x-request-id", "x-refract-remaining", "x-compare-remaining", "retry-after"];

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

  const ctx: AppContext = {
    env,
    prisma,
    redis,
    clock,
    quota: new Quota(redis, clock),
    budget: new Budget(redis, prisma, usdToMicro(env.DAILY_BUDGET_USD), clock),
    auth: new ApiKeyAuth(prisma, redis),
    openrouter: new OpenRouter({
      baseUrl: env.OPENROUTER_BASE_URL,
      apiKey: env.OPENROUTER_API_KEY,
      appUrl: `https://${env.SITE_DOMAIN}`,
      appTitle: env.OPENROUTER_APP_TITLE,
    }),
    tiers: tierPolicies(env),
    compareLimiter: new SlidingWindowLimiter(redis, "cmp", env.COMPARE_LIMIT_PER_HOUR, 3_600_000, clock),
    alert: createAlerter(app.log, env.ALERT_WEBHOOK_URL),
    ipHash: (ip) => hashIp(env.IP_HASH_SECRET, ip),
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
  await app.register(cors, {
    delegator: (req, cb) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      if (path.startsWith("/internal/compare")) {
        cb(null, {
          origin: allowedOrigins,
          methods: ["POST"],
          allowedHeaders: ["content-type"],
          exposedHeaders: EXPOSED_HEADERS,
          maxAge: 600,
        });
      } else {
        cb(null, {
          origin: "*",
          methods: ["GET", "POST"],
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
  await app.register(catalogRoutes);
  await app.register(modelsRoutes, { routeConfig: keyLimit });
  await app.register(chatRoutes, { routeConfig: keyLimit });
  await app.register(compareRoutes);

  return app;
}
