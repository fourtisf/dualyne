/**
 * Admin tool for API keys until self-serve keys (wallet sign-in) ship.
 *
 *   pnpm --filter @refract/api key:create --wallet 0xabc… [--tier holder] [--name "test"]
 *   pnpm --filter @refract/api key:create --list --wallet 0xabc…
 *   pnpm --filter @refract/api key:create --revoke <keyId>
 *
 * The full key is printed once. Only its SHA-256 hash is stored.
 */
import { PrismaClient, type Tier } from "@prisma/client";
import { TIERS } from "@refract/shared";
import { Redis } from "ioredis";
import { parseArgs } from "node:util";
import { ApiKeyAuth, generateApiKey } from "../src/auth/apiKey";

const { values } = parseArgs({
  options: {
    wallet: { type: "string" },
    tier: { type: "string" },
    name: { type: "string" },
    list: { type: "boolean", default: false },
    revoke: { type: "string" },
  },
});

async function main() {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const auth = new ApiKeyAuth(prisma, redis);
  try {
    if (values.revoke) {
      const ok = await auth.revoke(values.revoke);
      console.log(ok ? `Revoked key ${values.revoke}.` : `No key with id ${values.revoke}.`);
      return;
    }
    const address = (values.wallet ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("--wallet must be a 0x address (40 hex chars)");
    if (values.tier && !(TIERS as readonly string[]).includes(values.tier)) {
      throw new Error(`--tier must be one of: ${TIERS.join(", ")}`);
    }
    const tier = values.tier as Tier | undefined;

    if (values.list) {
      const wallet = await prisma.wallet.findUnique({ where: { address }, include: { keys: true } });
      if (!wallet) return console.log("No such wallet.");
      console.log(`Wallet ${address}  tier: ${wallet.tierOverride ?? "explorer"}`);
      for (const k of wallet.keys) {
        console.log(`  ${k.id}  …${k.last4}  ${k.name ?? ""}  created ${k.createdAt.toISOString()}`);
      }
      return;
    }

    const wallet = await prisma.wallet.upsert({
      where: { address },
      update: tier ? { tierOverride: tier } : {},
      create: { address, tierOverride: tier ?? null },
    });
    if (tier) await auth.bustWallet(wallet.id);
    const { key, hash, last4 } = generateApiKey();
    const row = await prisma.apiKey.create({
      data: { walletId: wallet.id, hash, last4, name: values.name ?? null },
    });
    console.log(`Key id:  ${row.id}`);
    console.log(`Wallet:  ${address}  (tier: ${wallet.tierOverride ?? "explorer"})`);
    console.log(`API key: ${key}`);
    console.log("Copy the key now. It is not stored and cannot be shown again.");
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
