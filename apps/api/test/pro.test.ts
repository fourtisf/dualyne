import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, FakeChain, newAccount, signIn, WEB_ORIGIN, type TestContext } from "./helpers";

const DEPOSIT = "0x4444444444444444444444444444444444444444";
const USDG = "0x3333333333333333333333333333333333333333";
const USDC = "0x6666666666666666666666666666666666666666";
const FEED = "0x5555555555555555555555555555555555555555";
const E18 = 10n ** 18n;
const DAY = 86_400_000;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const chain = new FakeChain();
let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext(
    {
      DEPOSIT_ADDRESS: DEPOSIT,
      USDG_TOKEN_ADDRESS: USDG,
      STABLECOINS: `USDC:${USDC}`,
      ETH_USD_FEED_ADDRESS: FEED,
      CHAIN_CONFIRMATIONS: "3",
      PRO_PRICE_USD: "19",
      PRO_CHAT_PER_DAY: "3",
      PRO_PREMIUM_PER_DAY: "1",
      SYBIL_CHECK: "off",
    },
    { chain },
  );
  await t.reset();
  t.upstream.mode = "stream";
  chain.txs.clear();
  chain.ethPrice = 2500;
});
afterAll(async () => t?.close());

const tokenTx = (token: string, from: string, units: bigint, confirmations = 5) => ({
  status: "success" as const,
  confirmations,
  from: from as `0x${string}`,
  to: token as `0x${string}`,
  value: 0n,
  transfers: [
    {
      token: token as `0x${string}`,
      from: from as `0x${string}`,
      to: DEPOSIT as `0x${string}`,
      value: units,
    },
  ],
});
const ethTx = (from: string, wei: bigint) => ({
  status: "success" as const,
  confirmations: 5,
  from: from as `0x${string}`,
  to: DEPOSIT as `0x${string}`,
  value: wei,
  transfers: [],
});
const pay = (cookie: string, txHash: string) =>
  t.app.inject({
    method: "POST",
    url: "/me/pro/payments",
    headers: { cookie, origin: WEB_ORIGIN },
    payload: { txHash },
  });
const me = (cookie: string) => t.app.inject({ method: "GET", url: "/me/pro", headers: { cookie } });
const chatAs = (cookie: string | null, model: string) =>
  t.app.inject({
    method: "POST",
    url: "/internal/chat",
    headers: cookie ? { cookie } : {},
    payload: {
      model,
      messages: [{ role: "user", content: "Hi" }],
      ...(cookie ? {} : { turnstileToken: "good-chat" }),
    },
  });

async function proUser() {
  const account = newAccount();
  const { cookie } = await signIn(t, account);
  chain.txs.set(hash(1), tokenTx(USDC, account.address, 19n * E18));
  expect((await pay(cookie, hash(1))).statusCode).toBe(200);
  const wallet = await t.prisma.wallet.findUniqueOrThrow({
    where: { address: account.address.toLowerCase() },
  });
  return { cookie, account, wallet };
}

describe("Pro payments", () => {
  it("shows the price and how to pay before buying", async () => {
    const { cookie } = await signIn(t, newAccount());
    const body = (await me(cookie)).json();
    expect(body).toMatchObject({
      active: false,
      proUntil: null,
      priceUsd: 19,
      days: 30,
      open: true,
      payTo: DEPOSIT,
      ethUsd: 2500,
      confirmations: 3,
    });
    expect(body.tokens.map((x: { symbol: string }) => x.symbol)).toEqual(["USDG", "USDC"]);
    expect((await t.app.inject({ method: "GET", url: "/me/pro" })).statusCode).toBe(401);
  });

  it("activates Pro for 30 days with a stablecoin payment, once", async () => {
    const { cookie, account, wallet } = await proUser();
    expect(wallet.proUntil!.getTime()).toBe(t.now.value.getTime() + 30 * DAY);
    const again = await pay(cookie, hash(1));
    expect(again.json()).toMatchObject({ status: "active", days: 30 });
    expect(await t.prisma.proPayment.count()).toBe(1);
    expect((await me(cookie)).json()).toMatchObject({ active: true, payments: [{ asset: "USDC", usd: 19 }] });

    // Someone else can't claim the same transaction.
    const other = await signIn(t, newAccount());
    expect((await pay(other.cookie, hash(1))).json().error.code).toBe("already_used");
    // Nor can it also count as API credit.
    const credit = await t.app.inject({
      method: "POST",
      url: "/me/credits/deposits",
      headers: { cookie, origin: WEB_ORIGIN },
      payload: { txHash: hash(1) },
    });
    expect(credit.json().error.code).toBe("already_used");
    expect(account).toBeTruthy();
  });

  it("stacks payments and accepts ETH at the feed price, with a little slack", async () => {
    const { cookie, account } = await proUser();
    chain.txs.set(hash(2), tokenTx(USDG, account.address, 38n * E18)); // two periods
    expect((await pay(cookie, hash(2))).json()).toMatchObject({ status: "active", days: 60 });
    chain.txs.set(hash(3), ethTx(account.address, 7_500_000_000_000_000n)); // 0.0075 ETH = $18.75
    expect((await pay(cookie, hash(3))).json()).toMatchObject({ days: 30, asset: "ETH", amount: "0.0075" });
    const w = await t.prisma.wallet.findUniqueOrThrow({ where: { address: account.address.toLowerCase() } });
    expect(w.proUntil!.getTime()).toBe(t.now.value.getTime() + 120 * DAY);
  });

  it("keeps an underpayment as API credit instead of losing it", async () => {
    const account = newAccount();
    const { cookie } = await signIn(t, account);
    chain.txs.set(hash(4), tokenTx(USDC, account.address, 10n * E18));
    const res = await pay(cookie, hash(4));
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe("underpaid");
    const credits = await t.app.inject({ method: "GET", url: "/me/credits", headers: { cookie } });
    expect(credits.json()).toMatchObject({ balanceUsd: 10 });
    expect((await me(cookie)).json().active).toBe(false);
  });

  it("waits for confirmations and checks the sender", async () => {
    const account = newAccount();
    const { cookie } = await signIn(t, account);
    chain.txs.set(hash(5), tokenTx(USDC, account.address, 19n * E18, 1));
    const pending = await pay(cookie, hash(5));
    expect(pending.statusCode).toBe(202);
    expect(pending.json()).toMatchObject({ status: "pending", confirmations: 1, required: 3 });
    chain.txs.set(hash(6), tokenTx(USDC, newAccount().address, 19n * E18));
    expect((await pay(cookie, hash(6))).json().error.code).toBe("wrong_sender");
  });
});

describe("Pro in Chat", () => {
  it("free visitors get the free models only; Pro gets premium ones too", async () => {
    const free = await chatAs(null, "gpt");
    expect(free.statusCode).toBe(403);
    expect(free.json().error.code).toBe("model_not_allowed");

    const { cookie, wallet } = await proUser();
    const res = await chatAs(cookie, "gpt");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: done");
    const row = await t.prisma.usageLog.findFirstOrThrow({ where: { modelId: "gpt" } });
    expect(row.walletId).toBe(wallet.id);
    // Longer answers for Pro.
    expect(t.upstream.requests.at(-1)!.body.max_tokens).toBe(2000);

    const quota = await t.app.inject({ method: "GET", url: "/internal/chat/quota", headers: { cookie } });
    expect(quota.json()).toMatchObject({
      plan: "pro",
      limit: 3,
      remaining: 2,
      premiumLimit: 1,
      premiumRemaining: 0,
    });
  });

  it("enforces the premium and daily Pro limits; free models keep working after premium runs out", async () => {
    const { cookie } = await proUser();
    expect((await chatAs(cookie, "gpt")).statusCode).toBe(200);
    const second = await chatAs(cookie, "gemini");
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("premium_limit");
    expect((await chatAs(cookie, "llama")).statusCode).toBe(200);
    expect((await chatAs(cookie, "llama")).statusCode).toBe(200);
    const over = await chatAs(cookie, "llama");
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe("rate_limited");
  });

  it("isn't stopped by the free plan's daily budget", async () => {
    const { cookie } = await proUser();
    await t.redis.set("spend:2026-09-23", String(10 ** 12));
    expect((await chatAs(null, "llama")).json().error.code).toBe("budget_exhausted");
    expect((await chatAs(cookie, "llama")).statusCode).toBe(200);
  });

  it("applies fair use to premium models", async () => {
    const { cookie, wallet } = await proUser();
    await t.prisma.usageLog.create({
      data: {
        source: "chat",
        walletId: wallet.id,
        modelId: "claude-deep",
        openrouterId: "anthropic/claude-opus-4.5",
        inputTokens: 1,
        outputTokens: 1,
        costMicroUsd: 15_000_000n,
        latencyMs: 1,
        status: 200,
        stream: true,
        createdAt: t.now.value,
      },
    });
    const res = await chatAs(cookie, "gpt");
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("fair_use");
    expect((await chatAs(cookie, "llama")).statusCode).toBe(200);
  });

  it("ends when Pro runs out", async () => {
    const { cookie, wallet } = await proUser();
    await t.prisma.wallet.update({
      where: { id: wallet.id },
      data: { proUntil: new Date(t.now.value.getTime() - 1) },
    });
    expect((await chatAs(cookie, "gpt")).json().error.code).toBe("model_not_allowed");
  });
});
