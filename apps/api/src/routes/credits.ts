import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { requireOwnOrigin, requireWallet } from "../auth/request";
import { ApiError } from "../lib/errors";
import { microToUsd } from "../lib/money";

const depositBody = z
  .object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash") })
  .strict();

const sameAddr = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Whole-token amount as a decimal string, e.g. 12.5 */
function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

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

      const tx = await ctx.chain.getDepositTx(hash);
      if (!tx || tx.status === "pending" || tx.confirmations < env.CHAIN_CONFIRMATIONS) {
        return reply.status(202).send({
          status: "pending",
          confirmations: tx?.confirmations ?? 0,
          required: env.CHAIN_CONFIRMATIONS,
        });
      }
      if (tx.status === "reverted") throw new ApiError(400, "tx_failed", "This transaction failed on-chain.");
      if (!sameAddr(tx.from, wallet.address)) {
        throw new ApiError(
          403,
          "wrong_sender",
          "This payment was sent from a different wallet. Top-ups are credited to the wallet that sent them.",
        );
      }

      const deposit = env.DEPOSIT_ADDRESS as Address;
      let asset: "USDG" | "ETH";
      let amount: string;
      let usdMicro: bigint;
      const usdgIn = env.USDG_TOKEN_ADDRESS
        ? tx.transfers
            .filter(
              (t) =>
                sameAddr(t.token, env.USDG_TOKEN_ADDRESS) &&
                sameAddr(t.to, deposit) &&
                sameAddr(t.from, wallet.address),
            )
            .reduce((a, t) => a + t.value, 0n)
        : 0n;
      if (usdgIn > 0n) {
        const decimals = await ctx.chain.tokenDecimals(getAddress(env.USDG_TOKEN_ADDRESS!));
        asset = "USDG";
        amount = formatUnits(usdgIn, decimals);
        usdMicro =
          decimals >= 6 ? usdgIn / 10n ** BigInt(decimals - 6) : usdgIn * 10n ** BigInt(6 - decimals);
      } else if (sameAddr(tx.to, deposit) && tx.value > 0n && env.ETH_USD_FEED_ADDRESS) {
        const price = await ctx.chain.ethUsdPrice(getAddress(env.ETH_USD_FEED_ADDRESS));
        asset = "ETH";
        amount = formatUnits(tx.value, 18);
        usdMicro = (tx.value * BigInt(Math.round(price * 1e6))) / 10n ** 18n;
      } else {
        throw new ApiError(
          400,
          "no_payment",
          "This transaction didn't send USDG or ETH to the deposit address.",
        );
      }
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
