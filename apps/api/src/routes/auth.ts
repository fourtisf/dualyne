import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { clearSessionCookie, requireOwnOrigin, setSessionCookie } from "../auth/request";
import { SESSION_COOKIE } from "../auth/sessions";
import { verifySiwe } from "../auth/siwe";
import { webHosts, webOrigins } from "../env";
import { buildMe } from "./me";

const NONCE_TTL_SECONDS = 300;
const verifyBody = z
  .object({
    message: z.string().min(1).max(4000),
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/, "Invalid signature")
      .max(20_000),
  })
  .strict();

/** Sign-In With Ethereum (EIP-4361). */
export const authRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;

  app.get("/auth/nonce", { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (_req, reply) => {
    const nonce = randomBytes(16).toString("hex");
    await ctx.redis.set(`siwe:nonce:${nonce}`, "1", "EX", NONCE_TTL_SECONDS);
    reply.header("cache-control", "no-store");
    return { nonce, chainId: ctx.env.SIWE_CHAIN_ID };
  });

  app.post("/auth/verify", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (req, reply) => {
    requireOwnOrigin(ctx, req);
    const body = verifyBody.parse(req.body);
    const address = await verifySiwe(body.message, body.signature as `0x${string}`, {
      hosts: webHosts(ctx.env),
      origins: webOrigins(ctx.env),
      chainId: ctx.env.SIWE_CHAIN_ID,
      now: ctx.clock(),
      consumeNonce: async (n) => (await ctx.redis.del(`siwe:nonce:${n}`)) === 1,
      chain: ctx.chain,
    });
    const wallet = await ctx.prisma.wallet.upsert({
      where: { address: address.toLowerCase() },
      update: {},
      create: { address: address.toLowerCase() },
    });
    const { token } = await ctx.sessions.create(wallet.id);
    setSessionCookie(ctx, reply, token);
    return buildMe(ctx, wallet);
  });

  /** Current session for the website: 200 with `me: null` when signed out (no console noise). */
  app.get(
    "/auth/session",
    { config: { rateLimit: { max: 120, timeWindow: 60_000 } } },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      const wallet = await ctx.sessions.get(req.cookies[SESSION_COOKIE]);
      return { me: wallet ? await buildMe(ctx, wallet) : null };
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    requireOwnOrigin(ctx, req);
    await ctx.sessions.destroy(req.cookies[SESSION_COOKIE]);
    clearSessionCookie(ctx, reply);
    return reply.status(204).send();
  });
};
