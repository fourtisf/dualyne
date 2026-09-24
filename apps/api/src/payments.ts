import { getAddress, type Address, type Hex } from "viem";
import type { AppContext } from "./context";
import { ApiError } from "./lib/errors";

/**
 * Crypto payments to DEPOSIT_ADDRESS, shared by Builder top-ups and the Pro plan: stablecoins
 * (USDG plus STABLECOINS, 1 token = $1) and ETH (priced by the Chainlink feed). A payment counts
 * once it has CHAIN_CONFIRMATIONS and comes from the signed-in wallet.
 */
export interface PayToken {
  symbol: string;
  address: Address;
}

export function stablecoins(env: AppContext["env"]): PayToken[] {
  const all: PayToken[] = [];
  if (env.USDG_TOKEN_ADDRESS) all.push({ symbol: "USDG", address: getAddress(env.USDG_TOKEN_ADDRESS) });
  for (const t of env.STABLECOINS) {
    if (!all.some((x) => x.address.toLowerCase() === t.address)) {
      all.push({ symbol: t.symbol, address: getAddress(t.address) });
    }
  }
  return all;
}

/** Payments can be taken: a chain to read and an address to receive. */
export const paymentsOpen = (ctx: AppContext) => Boolean(ctx.chain && ctx.env.DEPOSIT_ADDRESS);

export type Verified =
  | { status: "pending"; confirmations: number; required: number }
  | { status: "paid"; asset: string; amount: string; usdMicro: bigint };

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Whole-token amount as a decimal string, e.g. 12.5 */
export function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Whether a transaction hash already paid for credits or Pro (each payment counts once). */
export async function txAlreadyUsed(ctx: AppContext, hash: string): Promise<"credits" | "pro" | null> {
  const [deposit, pro] = await Promise.all([
    ctx.prisma.deposit.findUnique({ where: { txHash: hash } }),
    ctx.prisma.proPayment.findUnique({ where: { txHash: hash } }),
  ]);
  return deposit ? "credits" : pro ? "pro" : null;
}

/** Read a payment from the chain and value it in micro-USD. Throws ApiError when it doesn't count. */
export async function verifyPayment(ctx: AppContext, walletAddress: string, hash: Hex): Promise<Verified> {
  const { env } = ctx;
  if (!ctx.chain || !env.DEPOSIT_ADDRESS) {
    throw new ApiError(404, "payments_closed", "Payments are not open yet.");
  }
  const tx = await ctx.chain.getDepositTx(hash);
  if (!tx || tx.status === "pending" || tx.confirmations < env.CHAIN_CONFIRMATIONS) {
    return { status: "pending", confirmations: tx?.confirmations ?? 0, required: env.CHAIN_CONFIRMATIONS };
  }
  if (tx.status === "reverted") throw new ApiError(400, "tx_failed", "This transaction failed on-chain.");
  if (!same(tx.from, walletAddress)) {
    throw new ApiError(
      403,
      "wrong_sender",
      "This payment was sent from a different wallet. Payments count for the wallet that sent them.",
    );
  }
  const deposit = env.DEPOSIT_ADDRESS;
  for (const token of stablecoins(env)) {
    const units = tx.transfers
      .filter((t) => same(t.token, token.address) && same(t.to, deposit) && same(t.from, walletAddress))
      .reduce((a, t) => a + t.value, 0n);
    if (units > 0n) {
      const decimals = await ctx.chain.tokenDecimals(token.address);
      const usdMicro =
        decimals >= 6 ? units / 10n ** BigInt(decimals - 6) : units * 10n ** BigInt(6 - decimals);
      return { status: "paid", asset: token.symbol, amount: formatUnits(units, decimals), usdMicro };
    }
  }
  if (same(tx.to, deposit) && tx.value > 0n && env.ETH_USD_FEED_ADDRESS) {
    const price = await ctx.chain.ethUsdPrice(getAddress(env.ETH_USD_FEED_ADDRESS));
    const usdMicro = (tx.value * BigInt(Math.round(price * 1e6))) / 10n ** 18n;
    return { status: "paid", asset: "ETH", amount: formatUnits(tx.value, 18), usdMicro };
  }
  const accepted = [...stablecoins(env).map((t) => t.symbol), ...(env.ETH_USD_FEED_ADDRESS ? ["ETH"] : [])];
  throw new ApiError(
    400,
    "no_payment",
    `This transaction didn't send ${accepted.join(", ") || "a supported token"} to the payment address.`,
  );
}
