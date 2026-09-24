import type { FastifyPluginAsync } from "fastify";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import type { ProPaymentResponse, ProResponse } from "@dualyne/shared";
import { requireOwnOrigin, requireWallet } from "../auth/request";
import { ApiError } from "../lib/errors";
import { microToUsd } from "../lib/money";
import { paymentsOpen, stablecoins, txAlreadyUsed, verifyPayment } from "../payments";
import { applyProPayment, isPro, periodsPaid } from "../pro";

const payBody = z
  .object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash") })
  .strict();

/** The Pro plan for the signed-in wallet: status, how to pay, and payments verified by hash. */
export const proRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { env } = ctx;

  app.get("/me/pro", { config: { rateLimit: { max: 120, timeWindow: 60_000 } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const wallet = await requireWallet(ctx, req);
    const open = paymentsOpen(ctx);
    const [tokens, ethUsd, payments] = await Promise.all([
      Promise.all(
        stablecoins(env).map(async (t) => ({
          symbol: t.symbol,
          address: t.address,
          decimals: ctx.chain ? await ctx.chain.tokenDecimals(t.address).catch(() => null) : null,
        })),
      ),
      open && env.ETH_USD_FEED_ADDRESS
        ? ctx.chain!.ethUsdPrice(getAddress(env.ETH_USD_FEED_ADDRESS)).catch(() => null)
        : Promise.resolve(null),
      ctx.prisma.proPayment.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    const body: ProResponse = {
      active: isPro(wallet, ctx.clock()),
      proUntil: wallet.proUntil?.toISOString() ?? null,
      priceUsd: env.PRO_PRICE_USD,
      days: env.PRO_DAYS,
      chatPerDay: env.PRO_CHAT_PER_DAY,
      premiumPerDay: env.PRO_PREMIUM_PER_DAY,
      open,
      chainId: env.SIWE_CHAIN_ID,
      payTo: open ? env.DEPOSIT_ADDRESS! : null,
      tokens,
      ethUsd,
      confirmations: env.CHAIN_CONFIRMATIONS,
      payments: payments.map((p) => ({
        txHash: p.txHash,
        asset: p.asset,
        amount: p.amount,
        usd: microToUsd(p.usdMicro),
        days: p.days,
        createdAt: p.createdAt.toISOString(),
      })),
    };
    return body;
  });

  app.post(
    "/me/pro/payments",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req, reply) => {
      requireOwnOrigin(ctx, req);
      const wallet = await requireWallet(ctx, req);
      if (!paymentsOpen(ctx)) throw new ApiError(404, "payments_closed", "Pro payments are not open yet.");
      const hash = payBody.parse(req.body).txHash.toLowerCase() as Hex;

      const done = await ctx.prisma.proPayment.findUnique({ where: { txHash: hash } });
      if (done) {
        if (done.walletId !== wallet.id) {
          throw new ApiError(409, "already_used", "This transaction already paid for another wallet.");
        }
        const w = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        const body: ProPaymentResponse = {
          status: "active",
          proUntil: w.proUntil!.toISOString(),
          days: done.days,
        };
        return body;
      }
      if (await txAlreadyUsed(ctx, hash)) {
        throw new ApiError(409, "already_used", "This transaction was already used for credits.");
      }

      const paid = await verifyPayment(ctx, wallet.address, hash);
      if (paid.status === "pending") return reply.status(202).send(paid);

      const periods = periodsPaid(paid.usdMicro, env.PRO_PRICE_USD);
      if (periods < 1) {
        // Not enough for Pro: keep the money as credit rather than lose it.
        if (ctx.credits.enabled) {
          await ctx.prisma.$transaction(async (db) => {
            await db.deposit.create({
              data: {
                walletId: wallet.id,
                txHash: hash,
                asset: paid.asset,
                amount: paid.amount,
                usdMicro: paid.usdMicro,
              },
            });
            await ctx.credits.add(db, wallet.id, paid.usdMicro);
          });
        }
        throw new ApiError(
          402,
          "underpaid",
          `Pro costs $${env.PRO_PRICE_USD}; this payment was worth $${microToUsd(paid.usdMicro).toFixed(2)}.` +
            (ctx.credits.enabled
              ? " We added it to your API credit balance instead."
              : " Contact us to sort it out."),
        );
      }

      const until = await applyProPayment(ctx, wallet, {
        txHash: hash,
        asset: paid.asset,
        amount: paid.amount,
        usdMicro: paid.usdMicro,
        periods,
      });
      const w = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const body: ProPaymentResponse = {
        status: "active",
        proUntil: (until ?? w.proUntil!).toISOString(),
        days: periods * env.PRO_DAYS,
        asset: paid.asset,
        amount: paid.amount,
        usd: microToUsd(paid.usdMicro),
      };
      return body;
    },
  );
};
