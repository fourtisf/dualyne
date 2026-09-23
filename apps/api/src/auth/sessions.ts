import type { PrismaClient, Wallet } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import type { Clock } from "../lib/time";

export const SESSION_COOKIE = "dly_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** Browser sessions after Sign-In With Ethereum. Only an HMAC of the cookie value is stored. */
export class Sessions {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
    private readonly now: Clock,
  ) {}

  private id(token: string): string {
    return createHmac("sha256", this.secret || "dev-only-session-secret")
      .update(token)
      .digest("hex");
  }

  async create(walletId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { id: this.id(token), walletId, expiresAt } });
    return { token, expiresAt };
  }

  async get(token: string | undefined): Promise<Wallet | null> {
    if (!token || token.length > 100) return null;
    const s = await this.prisma.session.findUnique({
      where: { id: this.id(token) },
      include: { wallet: true },
    });
    const now = this.now();
    if (!s || s.expiresAt <= now) return null;
    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.session
        .update({ where: { id: s.id }, data: { lastSeenAt: now } })
        .catch(() => undefined);
    }
    return s.wallet;
  }

  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { id: this.id(token) } });
  }

  async purgeExpired(): Promise<number> {
    const r = await this.prisma.session.deleteMany({ where: { expiresAt: { lte: this.now() } } });
    return r.count;
  }
}
