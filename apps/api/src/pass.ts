import type { Wallet } from "@prisma/client";
import { getAddress, type Address } from "viem";
import type { PassInfo } from "@dualyne/shared";
import type { AppContext } from "./context";
import { isPro } from "./pro";

/** How long a Pass balance is trusted before the chain is asked again. */
const HOLD_TTL_S = 300;
/** If the RPC is down, the last known answer stands for this long. */
const LAST_KNOWN_TTL_S = 86_400;
export const PASS_INFO_KEY = "cache:pass";
const INFO_TTL_S = 20;

const passAddress = (ctx: AppContext): Address | null =>
  ctx.env.PASS_NFT_ADDRESS && ctx.chain ? getAddress(ctx.env.PASS_NFT_ADDRESS) : null;

/** Whether the address holds at least one Dualyne Pass. Cached; false when no Pass is configured. */
export async function holdsPass(ctx: AppContext, address: string | null | undefined): Promise<boolean> {
  const pass = passAddress(ctx);
  if (!pass || !address) return false;
  const addr = address.toLowerCase();
  const cached = await ctx.redis.get(`pass:hold:${addr}`);
  if (cached !== null) return cached === "1";
  try {
    const held = (await ctx.chain!.tokenBalance(pass, getAddress(address))) > 0n;
    const v = held ? "1" : "0";
    await ctx.redis
      .multi()
      .set(`pass:hold:${addr}`, v, "EX", HOLD_TTL_S)
      .set(`pass:last:${addr}`, v, "EX", LAST_KNOWN_TTL_S)
      .exec();
    return held;
  } catch {
    return (await ctx.redis.get(`pass:last:${addr}`)) === "1";
  }
}

/** Pro from payment (proUntil) or from holding a Pass. */
export async function proStatus(
  ctx: AppContext,
  wallet: Pick<Wallet, "proUntil" | "address"> | null | undefined,
): Promise<{ active: boolean; pass: boolean }> {
  if (!wallet) return { active: false, pass: false };
  const pass = await holdsPass(ctx, wallet.address);
  return { active: pass || isPro(wallet, ctx.clock()), pass };
}

/** The sale as the contract reports it (cached for a few seconds). */
export async function passInfo(ctx: AppContext): Promise<PassInfo> {
  const pass = passAddress(ctx);
  const base: PassInfo = {
    enabled: Boolean(pass),
    address: pass,
    chainId: ctx.env.SIWE_CHAIN_ID,
    priceWei: null,
    minted: null,
    maxSupply: null,
    maxPerWallet: null,
    mintOpen: false,
  };
  if (!pass) return base;
  const cached = await ctx.redis.get(PASS_INFO_KEY);
  if (cached) return JSON.parse(cached) as PassInfo;
  try {
    const s = await ctx.chain!.passState(pass);
    const info: PassInfo = {
      ...base,
      priceWei: s.priceWei.toString(),
      minted: s.minted,
      maxSupply: s.maxSupply,
      maxPerWallet: s.maxPerWallet,
      mintOpen: s.mintOpen,
    };
    await ctx.redis.set(PASS_INFO_KEY, JSON.stringify(info), "EX", INFO_TTL_S);
    return info;
  } catch {
    // RPC trouble: the page shows the Pass without live numbers and tries again shortly.
    return base;
  }
}
