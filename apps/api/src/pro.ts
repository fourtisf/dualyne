import { Prisma, type Wallet } from "@prisma/client";
import type { AppContext } from "./context";

/**
 * The Pro plan: PRO_PRICE_USD buys PRO_DAYS of every model in Chat, paid in crypto to
 * DEPOSIT_ADDRESS. Payments stack (paying twice adds two periods). A small shortfall is accepted
 * because an ETH price can move between quote and payment.
 */
const SLACK = 0.03;

export const isPro = (w: Pick<Wallet, "proUntil"> | null | undefined, now: Date): boolean =>
  Boolean(w?.proUntil && w.proUntil.getTime() > now.getTime());

/** Whole Pro periods a payment covers (0 = not enough). */
export function periodsPaid(usdMicro: bigint, priceUsd: number): number {
  const price = BigInt(Math.round(priceUsd * 1e6));
  const slack = BigInt(Math.round(priceUsd * SLACK * 1e6));
  return Number((usdMicro + slack) / price);
}

/** Record a verified Pro payment and extend the wallet's Pro time. Returns the new end, or null
 *  when this transaction was already recorded. */
export async function applyProPayment(
  ctx: AppContext,
  wallet: Wallet,
  pay: { txHash: string; asset: string; amount: string; usdMicro: bigint; periods: number },
): Promise<Date | null> {
  const days = pay.periods * ctx.env.PRO_DAYS;
  try {
    return await ctx.prisma.$transaction(async (db) => {
      await db.proPayment.create({
        data: {
          txHash: pay.txHash,
          walletId: wallet.id,
          asset: pay.asset,
          amount: pay.amount,
          usdMicro: pay.usdMicro,
          days,
          createdAt: ctx.clock(),
        },
      });
      const current = await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const now = ctx.clock().getTime();
      const from = current.proUntil && current.proUntil.getTime() > now ? current.proUntil.getTime() : now;
      const until = new Date(from + days * 86_400_000);
      await db.wallet.update({ where: { id: wallet.id }, data: { proUntil: until } });
      return until;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

/** Model cost of this wallet's premium chat answers over the last PRO_DAYS, in micro-USD. */
export async function premiumSpendMicro(ctx: AppContext, walletId: string): Promise<number> {
  const since = new Date(ctx.clock().getTime() - ctx.env.PRO_DAYS * 86_400_000);
  const premium = await ctx.prisma.model.findMany({
    where: { minTier: { not: "explorer" } },
    select: { id: true },
  });
  const agg = await ctx.prisma.usageLog.aggregate({
    _sum: { costMicroUsd: true },
    where: {
      walletId,
      source: "chat",
      createdAt: { gte: since },
      modelId: { in: premium.map((m) => m.id) },
    },
  });
  return Number(agg._sum.costMicroUsd ?? 0n);
}
