import type { PrismaClient, Tier } from "@prisma/client";
import type { TierService } from "../tierService";
import { brand } from "@refract/config";
import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { ApiError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";

const CACHE_TTL_SECONDS = 30;
const KEY_RE = new RegExp(`^${brand.keyPrefix}[0-9a-f]{32}$`);
const cacheKey = (hash: string) => `keycache:${hash}`;

export interface KeyPrincipal {
  keyId: string;
  walletId: string;
  walletAddress: string;
  tier: Tier;
}

/** New key: prefix + 32 random hex chars. Only its hash is ever stored. */
export function generateApiKey(): { key: string; hash: string; last4: string } {
  const key = `${brand.keyPrefix}${randomBytes(16).toString("hex")}`;
  return { key, hash: sha256Hex(key), last4: key.slice(-4) };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

export class ApiKeyAuth {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly tiers: TierService,
  ) {}

  /** Resolve the Authorization header to a key principal, or throw 401. */
  async authenticate(authorization: string | undefined): Promise<KeyPrincipal> {
    const token = bearerToken(authorization);
    if (!token) {
      throw new ApiError(401, "missing_api_key", "Missing API key. Send it as: Authorization: Bearer <key>.");
    }
    if (!KEY_RE.test(token)) throw invalid();
    const hash = sha256Hex(token);

    const cached = await this.redis.get(cacheKey(hash));
    if (cached === "none") throw invalid();
    if (cached) return JSON.parse(cached) as KeyPrincipal;

    const row = await this.prisma.apiKey.findUnique({ where: { hash }, include: { wallet: true } });
    if (!row) {
      await this.redis.set(cacheKey(hash), "none", "EX", CACHE_TTL_SECONDS);
      throw invalid();
    }
    const principal: KeyPrincipal = {
      keyId: row.id,
      walletId: row.walletId,
      walletAddress: row.wallet.address,
      tier: (await this.tiers.resolve(row.wallet)).tier,
    };
    await this.redis.set(cacheKey(hash), JSON.stringify(principal), "EX", CACHE_TTL_SECONDS);
    return principal;
  }

  /** Revoke = delete the hash. The cache entry goes too, so it fails on the very next request. */
  async revoke(keyId: string): Promise<boolean> {
    const row = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!row) return false;
    await this.prisma.apiKey.delete({ where: { id: keyId } });
    await this.redis.del(cacheKey(row.hash));
    return true;
  }

  /** Drop cached principals for a wallet's keys (after a tier change). */
  async bustWallet(walletId: string): Promise<void> {
    const keys = await this.prisma.apiKey.findMany({ where: { walletId }, select: { hash: true } });
    if (keys.length) await this.redis.del(...keys.map((k) => cacheKey(k.hash)));
  }
}

const invalid = () =>
  new ApiError(
    401,
    "invalid_api_key",
    "Invalid API key. Check the key or create a new one in the dashboard.",
  );
