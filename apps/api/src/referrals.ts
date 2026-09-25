import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient, Wallet } from "@prisma/client";

/** Invite codes: 8 characters without look-alikes (0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_RE = /^[23456789A-HJ-KM-NP-Z]{8}$/;

export function newReferralCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** The account a referral code belongs to, or null (unknown or malformed code). */
export async function referrerFor(prisma: PrismaClient, code: string | undefined): Promise<string | null> {
  const c = code?.trim().toUpperCase();
  if (!c || !REFERRAL_CODE_RE.test(c)) return null;
  const w = await prisma.wallet.findUnique({ where: { referralCode: c }, select: { id: true } });
  return w?.id ?? null;
}

/** The account's invite code, made on first use. */
export async function ensureReferralCode(prisma: PrismaClient, wallet: Wallet): Promise<string> {
  if (wallet.referralCode) return wallet.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode();
    const r = await prisma.wallet.updateMany({
      where: { id: wallet.id, referralCode: null },
      data: { referralCode: code },
    });
    if (r.count) return code;
    const again = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    if (again.referralCode) return again.referralCode;
  }
  throw new Error("Couldn't make a referral code");
}

/**
 * Inside a Pro payment: the first time an invited account pays, its inviter gets `days` of Pro,
 * added on top of any Pro time left. One reward per invited account.
 */
export async function rewardReferrer(
  db: Prisma.TransactionClient,
  referee: Pick<Wallet, "id" | "referredById">,
  days: number,
  now: Date,
): Promise<void> {
  if (!referee.referredById || days <= 0) return;
  const done = await db.referralReward.findUnique({ where: { refereeId: referee.id } });
  if (done) return;
  const referrer = await db.wallet.findUnique({ where: { id: referee.referredById } });
  if (!referrer) return;
  await db.referralReward.create({
    data: { refereeId: referee.id, referrerId: referrer.id, days, createdAt: now },
  });
  const from = referrer.proUntil && referrer.proUntil > now ? referrer.proUntil.getTime() : now.getTime();
  await db.wallet.update({
    where: { id: referrer.id },
    data: { proUntil: new Date(from + days * 86_400_000) },
  });
}
