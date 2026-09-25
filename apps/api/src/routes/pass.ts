import type { FastifyPluginAsync } from "fastify";
import { requireOwnOrigin, requireWallet } from "../auth/request";
import { holdsPass, PASS_INFO_KEY, passInfo } from "../pass";

export const passRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;

  /** The Dualyne Pass sale (price, supply, minted, open) for the mint page. */
  app.get("/pass", { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=10");
    return passInfo(ctx);
  });

  /** After a mint: re-read the wallet's Pass balance and the sale now, instead of waiting for the caches. */
  app.post(
    "/me/pass/refresh",
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      requireOwnOrigin(ctx, req);
      const wallet = await requireWallet(ctx, req);
      reply.header("cache-control", "no-store");
      // The sale numbers changed too.
      await ctx.redis.del(PASS_INFO_KEY);
      if (wallet.address) await ctx.redis.del(`pass:hold:${wallet.address.toLowerCase()}`);
      return { pass: await holdsPass(ctx, wallet.address) };
    },
  );
};
