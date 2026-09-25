import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import { requireOwnOrigin, requireWallet } from "../auth/request";
import { ApiError } from "../lib/errors";
import { microToUsd } from "../lib/money";
import { stablecoins, txAlreadyUsed, verifyPayment } from "../payments";

const depositBody = z
  .object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash") })
  .strict();

/** Builder prepaid credit: balance, deposit address and top-ups verified by transaction hash. */
export const creditRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const { env } = ctx;

  app.get("/me/credits", { config: { rateLimit: { max: 120, timeWindow: 60_000 } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const wallet = await requireWallet(ctx, req);
    if (!ctx.credits.enabled) return { enabled: false };
    const [balance, deposits, usdgDecimals] = await Promise.all([
      ctx.credits.balance(wallet.id),
      ctx.prisma.deposit.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      env.USDG_TOKEN_ADDRESS && ctx.chain
        ? ctx.chain.tokenDecimals(getAddress(env.USDG_TOKEN_ADDRESS)).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      enabled: true,
      balanceUsd: microToUsd(balance),
      markup: ctx.credits.markup,
      chainId: env.SIWE_CHAIN_ID,
      depositAddress: env.DEPOSIT_ADDRESS,
      usdgAddress: env.USDG_TOKEN_ADDRESS ?? null,
      usdgDecimals,
      tokens: await Promise.all(
        stablecoins(env).map(async (t) => ({
          symbol: t.symbol,
          address: t.address,
          decimals: ctx.chain ? await ctx.chain.tokenDecimals(t.address).catch(() => null) : null,
        })),
      ),
      ethEnabled: Boolean(env.ETH_USD_FEED_ADDRESS),
      confirmations: env.CHAIN_CONFIRMATIONS,
      deposits: deposits.map((d) => ({
        txHash: d.txHash,
        asset: d.asset,
        amount: d.amount,
        usd: microToUsd(d.usdMicro),
        createdAt: d.createdAt,
      })),
    };
  });

  app.post(
    "/me/credits/deposits",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req, reply) => {
      requireOwnOrigin(ctx, req);
      const wallet = await requireWallet(ctx, req);
      if (!ctx.credits.enabled || !ctx.chain || !env.DEPOSIT_ADDRESS) {
        throw new ApiError(404, "credits_disabled", "Top-ups are not open yet.");
      }
      const { txHash } = depositBody.parse(req.body);
      const hash = txHash.toLowerCase() as Hex;

      const existing = await ctx.prisma.deposit.findUnique({ where: { txHash: hash } });
      if (existing) {
        if (existing.walletId !== wallet.id) {
          throw new ApiError(409, "already_used", "This transaction was already credited to another wallet.");
        }
        return {
          status: "credited",
          usd: microToUsd(existing.usdMicro),
          balanceUsd: microToUsd(await ctx.credits.balance(wallet.id)),
        };
      }

      if ((await txAlreadyUsed(ctx, hash)) === "pro") {
        throw new ApiError(409, "already_used", "This transaction already paid for Pro.");
      }
      if (!wallet.address) {
        throw new ApiError(
          403,
          "wallet_required",
          "Link a wallet to your account first: payments are checked against the wallet that sends them.",
        );
      }
      const paid = await verifyPayment(ctx, wallet.address, hash);
      if (paid.status === "pending") return reply.status(202).send(paid);
      const { asset, amount, usdMicro } = paid;
      if (usdMicro <= 0n) throw new ApiError(400, "no_payment", "The amount is too small to credit.");

      let balance: bigint;
      try {
        balance = await ctx.prisma.$transaction(async (db) => {
          await db.deposit.create({ data: { walletId: wallet.id, txHash: hash, asset, amount, usdMicro } });
          return ctx.credits.add(db, wallet.id, usdMicro);
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          // Another request credited this transaction a moment ago.
          return {
            status: "credited",
            usd: microToUsd(usdMicro),
            balanceUsd: microToUsd(await ctx.credits.balance(wallet.id)),
          };
        }
        throw e;
      }
      await ctx.auth.bustWallet(wallet.id); // the wallet may now be Builder
      return {
        status: "credited",
        asset,
        amount,
        usd: microToUsd(usdMicro),
        balanceUsd: microToUsd(balance),
      };
    },
  );
};
