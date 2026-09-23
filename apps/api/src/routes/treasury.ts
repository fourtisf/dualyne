import type { FastifyPluginAsync } from "fastify";
import type { Address } from "viem";
import type { AppContext } from "../context";
import { treasurySummary, type TreasuryConfig } from "../treasury";

const CACHE_KEY = "cache:treasury";
const CACHE_TTL = 300;

/** Treasury settings, or null until the chain, treasury wallet and stablecoin are configured. */
export function treasuryConfig(ctx: AppContext): TreasuryConfig | null {
  const { env } = ctx;
  if (!ctx.chain || !env.TREASURY_WALLET_ADDRESS || !env.USDG_TOKEN_ADDRESS) return null;
  return {
    chain: ctx.chain,
    treasury: env.TREASURY_WALLET_ADDRESS as Address,
    stable: env.USDG_TOKEN_ADDRESS as Address,
    confirmations: env.CHAIN_CONFIRMATIONS,
    startBlock: env.TREASURY_START_BLOCK,
  };
}

/** Public ledger: balance, runway, 30-day series and daily in/out. Cached for 5 minutes. */
export const treasuryRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  app.get("/treasury", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    if (!treasuryConfig(ctx)) return { configured: false };
    const cached = await ctx.redis.get(CACHE_KEY);
    if (cached) return reply.type("application/json").send(cached);
    const summary = await treasurySummary(ctx.prisma, ctx.clock());
    const body = JSON.stringify(summary);
    await ctx.redis.set(CACHE_KEY, body, "EX", CACHE_TTL);
    return reply.type("application/json").send(body);
  });
};
