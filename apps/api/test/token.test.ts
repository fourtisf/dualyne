import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  chat,
  createKey,
  createTestContext,
  FakeChain,
  hello,
  newAccount,
  signIn,
  type TestContext,
} from "./helpers";

const RFX = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";
const USDG = "0x3333333333333333333333333333333333333333";
const E18 = 10n ** 18n;

const chain = new FakeChain();
let t: TestContext;
beforeEach(async () => {
  if (!t) {
    t = await createTestContext(
      {
        RFX_TOKEN_ADDRESS: RFX,
        HOLDER_MIN_RFX: "100000",
        TREASURY_WALLET_ADDRESS: TREASURY,
        USDG_TOKEN_ADDRESS: USDG,
        CHAIN_CONFIRMATIONS: "3",
        SYBIL_CHECK: "off",
      },
      { chain },
    );
  }
  await t.reset();
  t.upstream.mode = "json";
  t.now.value = new Date("2026-09-23T12:00:00Z");
  chain.tokenBalances.clear();
  chain.transfers = [];
  chain.head = 1000n;
  chain.failing = false;
});
afterAll(async () => t?.close());

const setRfx = (address: string, whole: bigint) =>
  chain.tokenBalances.set(`${RFX}:${address.toLowerCase()}`, whole * E18);

describe("Holder tier from the on-chain RFX balance", () => {
  it("makes a wallet Holder at exactly 100,000 RFX, not below", async () => {
    const below = await createKey(t.prisma, "explorer", `0x${"4".repeat(40)}`);
    await t.prisma.wallet.update({ where: { address: below.address }, data: { tierOverride: null } });
    setRfx(below.address, 99_999n);
    expect((await chat(t.app, below.key, hello("gpt"))).statusCode).toBe(403);

    const at = await createKey(t.prisma, "explorer", `0x${"5".repeat(40)}`);
    await t.prisma.wallet.update({ where: { address: at.address }, data: { tierOverride: null } });
    setRfx(at.address, 100_000n);
    const res = await chat(t.app, at.key, hello("gpt"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-refract-remaining"]).toBe("249");
  });

  it("caches the balance for 5 minutes", async () => {
    const tiers = t.app.ctx.tierService;
    const addr = `0x${"6".repeat(40)}`;
    setRfx(addr, 200_000n);
    expect(await tiers.isHolder(addr)).toBe(true);
    const calls = chain.calls;
    setRfx(addr, 0n);
    expect(await tiers.isHolder(addr)).toBe(true); // cached
    expect(chain.calls).toBe(calls);
    expect(await t.redis.ttl(`rfx:${addr}`)).toBeLessThanOrEqual(300);
    await t.redis.del(`rfx:${addr}`);
    expect(await tiers.isHolder(addr)).toBe(false);
  });

  it("keeps the last known balance when the chain is briefly unreachable", async () => {
    const tiers = t.app.ctx.tierService;
    const addr = `0x${"7".repeat(40)}`;
    setRfx(addr, 150_000n);
    expect(await tiers.isHolder(addr)).toBe(true);
    await t.redis.del(`rfx:${addr}`); // 5-minute cache expired
    chain.failing = true;
    expect(await tiers.isHolder(addr)).toBe(true);
  });

  it("shows the balance and tier source in /me", async () => {
    const account = newAccount();
    setRfx(account.address, 123_456n); // bought before signing in
    const { cookie } = await signIn(t, account);
    const me = (await t.app.inject({ method: "GET", url: "/me", headers: { cookie } })).json();
    expect(me).toMatchObject({
      tier: "holder",
      tierSource: "token",
      keys: { max: 5 },
      token: { balance: 123456, holderMin: 100000, symbol: "RFX" },
    });
  });
});

describe("treasury", () => {
  const transfer = (block: bigint, usdg: bigint, i = 0) => ({
    token: USDG,
    to: TREASURY,
    txHash: `0x${block.toString(16).padStart(64, "0")}` as `0x${string}`,
    logIndex: i,
    blockNumber: block,
    from: "0x9999999999999999999999999999999999999999" as const,
    value: usdg * E18,
  });

  it("records inflows once, resumes from the last block, and snapshots the balance", async () => {
    chain.head = 30_000n;
    chain.transfers = [transfer(25_000n, 500n), transfer(30_005n, 1_000n)];
    chain.tokenBalances.set(`${USDG}:${TREASURY}`, 18_420n * E18);
    const { syncTreasury } = await import("../src/treasury");
    const { treasuryConfig } = await import("../src/routes/treasury");
    const cfg = treasuryConfig(t.app.ctx)!;

    const r1 = await syncTreasury(t.prisma, cfg, () => t.now.value);
    // head 30,000 minus 3 confirmations; first run looks back 10,000 blocks.
    expect(r1).toEqual({ inserted: 1, scannedTo: 29_997n });
    expect(
      (await t.prisma.chainCursor.findUniqueOrThrow({ where: { name: "treasury-inflows" } })).block,
    ).toBe(29_997n);

    chain.head = 30_010n;
    const r2 = await syncTreasury(t.prisma, cfg, () => t.now.value);
    expect(r2.inserted).toBe(1);
    const again = await syncTreasury(t.prisma, cfg, () => t.now.value);
    expect(again.inserted).toBe(0);
    expect(await t.prisma.treasuryTransfer.count()).toBe(2);
    expect((await t.prisma.treasurySnapshot.findFirstOrThrow()).balanceMicroUsd).toBe(18_420_000_000n);
  });

  it("serves balance, inflow today, runway and requests from real records", async () => {
    const day = (d: number) => new Date(Date.UTC(2026, 8, d, 10));
    await t.prisma.treasurySnapshot.create({ data: { takenAt: day(23), balanceMicroUsd: 18_420_000_000n } });
    await t.prisma.treasuryTransfer.create({
      data: {
        id: "a:0",
        txHash: "a",
        blockNumber: 1n,
        timestamp: day(23),
        fromAddress: "x",
        amountMicroUsd: 832_000_000n,
      },
    });
    // 7 complete days of $450/day free-tier inference → runway 18,420 / 450 = 40.9 days.
    for (let d = 16; d <= 22; d++) {
      await t.prisma.usageLog.create({
        data: {
          createdAt: day(d),
          source: "compare",
          modelId: "claude-swift",
          openrouterId: "x",
          costMicroUsd: 450_000_000n,
          latencyMs: 1,
          status: 200,
          stream: true,
        },
      });
    }
    // Builder usage (charged to credits) is not treasury outflow.
    await t.prisma.usageLog.create({
      data: {
        createdAt: day(22),
        source: "api",
        modelId: "claude-swift",
        openrouterId: "x",
        costMicroUsd: 9_000_000_000n,
        chargedMicroUsd: 10_350_000_000n,
        latencyMs: 1,
        status: 200,
        stream: false,
      },
    });
    const res = (await t.app.inject({ method: "GET", url: "/treasury" })).json();
    expect(res).toMatchObject({
      configured: true,
      balanceUsd: 18420,
      inflowTodayUsd: 832,
      runwayDays: 40,
      requests7d: 7,
    });
    expect(res.days).toHaveLength(30);
    expect(res.days.at(-1)).toMatchObject({ day: "2026-09-23", inUsd: 832, balanceUsd: 18420 });
    expect(res.days.at(-2)).toMatchObject({ day: "2026-09-22", outUsd: 450 });
  });

  it("reports configured:false without a treasury setup", async () => {
    const plain = await createTestContext();
    const res = (await plain.app.inject({ method: "GET", url: "/treasury" })).json();
    expect(res).toEqual({ configured: false });
    await plain.close();
  });
});
