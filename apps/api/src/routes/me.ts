import { Prisma, type Wallet } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateApiKey } from "../auth/apiKey";
import { requireOwnOrigin, requireWallet } from "../auth/request";
import type { AppContext } from "../context";
import { ApiError } from "../lib/errors";
import { microToUsd } from "../lib/money";
import { utcDayStart } from "../lib/time";
import { brand } from "@dualyne/config";
import { tokenAmount } from "../tierService";

/** Everything the dashboard needs about the signed-in wallet. */
export async function buildMe(ctx: AppContext, wallet: Wallet) {
  const { tier, source } = await ctx.tierService.resolve(wallet);
  const policy = ctx.tiers[tier];
  const [used, keyCount] = await Promise.all([
    ctx.quota.used(wallet.address),
    ctx.prisma.apiKey.count({ where: { walletId: wallet.id } }),
  ]);
  const eligibility = tier === "explorer" && ctx.sybil.enabled ? await ctx.sybil.check(wallet.address) : null;
  const bal = ctx.tierService.tokenEnabled ? await ctx.tierService.tokenBalance(wallet.address) : null;
  const credit = ctx.credits.enabled ? await ctx.credits.balance(wallet.id) : 0n;
  return {
    address: wallet.address,
    tier,
    tierLabel: policy.label,
    tierSource: source,
    limits: { dailyRequests: policy.dailyRequests, maxTokens: policy.maxTokens, maxKeys: policy.maxKeys },
    usage: {
      today: used,
      remaining: policy.dailyRequests === null ? null : Math.max(0, policy.dailyRequests - used),
    },
    keys: { count: keyCount, max: policy.maxKeys },
    eligibility,
    credits: { enabled: ctx.credits.enabled, balanceUsd: microToUsd(credit) },
    token: bal
      ? {
          balance: tokenAmount(bal.units, bal.decimals),
          holderMin: ctx.tierService.holderMin,
          symbol: brand.tokenSymbol,
        }
      : null,
  };
}

const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
const createKeyBody = z.object({ name: z.string().trim().max(40).optional() }).strict();
const keyParams = z.object({ id: z.string().min(1).max(40) });

export const meRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const perIp = { rateLimit: { max: 120, timeWindow: 60_000 } };

  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/me")) reply.header("cache-control", "no-store");
  });

  app.get("/me", { config: perIp }, async (req) => buildMe(ctx, await requireWallet(ctx, req)));

  app.get("/me/usage", { config: perIp }, async (req) => {
    const wallet = await requireWallet(ctx, req);
    const { days } = usageQuery.parse(req.query);
    const since = new Date(utcDayStart(ctx.clock()).getTime() - (days - 1) * 86_400_000);
    const rows = await ctx.prisma.$queryRaw<{ day: Date; requests: bigint; cost: bigint | null }[]>(
      Prisma.sql`SELECT date_trunc('day', "createdAt") AS day,
                        count(*) AS requests, sum("costMicroUsd") AS cost
                 FROM "UsageLog"
                 WHERE "walletId" = ${wallet.id} AND source = 'api' AND "createdAt" >= ${since}
                 GROUP BY 1 ORDER BY 1`,
    );
    const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r]));
    const series = Array.from({ length: days }, (_, i) => {
      const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      const r = byDay.get(day);
      return { day, requests: Number(r?.requests ?? 0), costUsd: microToUsd(r?.cost ?? 0n) };
    });

    const perKey = await ctx.prisma.usageLog.groupBy({
      by: ["apiKeyId"],
      where: { walletId: wallet.id, source: "api", createdAt: { gte: since }, apiKeyId: { not: null } },
      _count: { _all: true },
      _sum: { costMicroUsd: true },
    });
    const keys = await ctx.prisma.apiKey.findMany({ where: { walletId: wallet.id } });
    const byKey = keys.map((k) => {
      const u = perKey.find((p) => p.apiKeyId === k.id);
      return {
        keyId: k.id,
        last4: k.last4,
        name: k.name,
        requests: u?._count._all ?? 0,
        costUsd: microToUsd(u?._sum.costMicroUsd ?? 0n),
      };
    });
    return { days: series, byKey };
  });

  app.get("/me/keys", { config: perIp }, async (req) => {
    const wallet = await requireWallet(ctx, req);
    const keys = await ctx.prisma.apiKey.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      data: keys.map((k) => ({
        id: k.id,
        name: k.name,
        last4: k.last4,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      })),
    };
  });

  app.post("/me/keys", { config: { rateLimit: { max: 10, timeWindow: 3_600_000 } } }, async (req, reply) => {
    requireOwnOrigin(ctx, req);
    const wallet = await requireWallet(ctx, req);
    if (!ctx.env.API_OPEN) {
      throw new ApiError(
        403,
        "api_closed",
        "API keys are coming soon. Follow us on X to hear when they open.",
      );
    }
    const body = createKeyBody.parse(req.body ?? {});
    const { tier } = await ctx.tierService.resolve(wallet);
    const policy = ctx.tiers[tier];

    if (tier === "explorer" && ctx.sybil.enabled) {
      const e = await ctx.sybil.check(wallet.address, { fresh: true });
      if (!e.eligible) throw new ApiError(403, "not_eligible", e.reason);
    }
    // Serialise key creation per wallet so parallel requests can't exceed the limit.
    const lockKey = `lock:keys:${wallet.id}`;
    if (!(await ctx.redis.set(lockKey, "1", "PX", 5000, "NX"))) {
      throw new ApiError(429, "busy", "Another key is being created. Try again in a moment.");
    }
    let created;
    try {
      if (policy.maxKeys !== null) {
        const count = await ctx.prisma.apiKey.count({ where: { walletId: wallet.id } });
        if (count >= policy.maxKeys) {
          throw new ApiError(
            403,
            "key_limit",
            `${policy.label} wallets can have ${policy.maxKeys} key${policy.maxKeys === 1 ? "" : "s"}. Revoke one to create another.`,
          );
        }
      }
      const { key, hash, last4 } = generateApiKey();
      const row = await ctx.prisma.apiKey.create({
        data: { walletId: wallet.id, hash, last4, name: body.name || null },
      });
      created = { id: row.id, name: row.name, last4, createdAt: row.createdAt, lastUsedAt: null, key };
    } finally {
      await ctx.redis.del(lockKey);
    }
    // `key` is returned once and never stored.
    return reply.status(201).send(created);
  });

  app.delete("/me/keys/:id", { config: perIp }, async (req, reply) => {
    requireOwnOrigin(ctx, req);
    const wallet = await requireWallet(ctx, req);
    const { id } = keyParams.parse(req.params);
    const key = await ctx.prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.walletId !== wallet.id) throw new ApiError(404, "key_not_found", "No such key.");
    await ctx.auth.revoke(id);
    return reply.status(204).send();
  });
};
