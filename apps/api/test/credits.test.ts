import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateApiKey } from "../src/auth/apiKey";
import {
  chat,
  createTestContext,
  FakeChain,
  hello,
  newAccount,
  signIn,
  WEB_ORIGIN,
  type TestContext,
} from "./helpers";

const DEPOSIT = "0x4444444444444444444444444444444444444444";
const USDG = "0x3333333333333333333333333333333333333333";
const FEED = "0x5555555555555555555555555555555555555555";
const E18 = 10n ** 18n;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const chain = new FakeChain();
let t: TestContext;
beforeEach(async () => {
  if (!t) {
    t = await createTestContext(
      {
        DEPOSIT_ADDRESS: DEPOSIT,
        USDG_TOKEN_ADDRESS: USDG,
        ETH_USD_FEED_ADDRESS: FEED,
        CHAIN_CONFIRMATIONS: "3",
        BUILDER_MARKUP: "1.15",
        SYBIL_CHECK: "off",
      },
      { chain },
    );
  }
  await t.reset();
  t.upstream.mode = "json";
  chain.txs.clear();
  chain.ethPrice = 2500;
});
afterAll(async () => t?.close());

const usdgTx = (from: string, units: bigint, confirmations = 5) => ({
  status: "success" as const,
  confirmations,
  from: from as `0x${string}`,
  to: USDG as `0x${string}`,
  value: 0n,
  transfers: [
    { token: USDG as `0x${string}`, from: from as `0x${string}`, to: DEPOSIT as `0x${string}`, value: units },
  ],
});
const deposit = (cookie: string, txHash: string) =>
  t.app.inject({
    method: "POST",
    url: "/me/credits/deposits",
    headers: { cookie, origin: WEB_ORIGIN },
    payload: { txHash },
  });

async function builderWithKey(usd: bigint) {
  const account = newAccount();
  const { cookie } = await signIn(t, account);
  chain.txs.set(hash(1), usdgTx(account.address, usd * E18));
  expect((await deposit(cookie, hash(1))).statusCode).toBe(200);
  const wallet = await t.prisma.wallet.findUniqueOrThrow({
    where: { address: account.address.toLowerCase() },
  });
  const { key, hash: h, last4 } = generateApiKey();
  await t.prisma.apiKey.create({ data: { walletId: wallet.id, hash: h, last4 } });
  return { cookie, key, walletId: wallet.id, account };
}

describe("Builder top-ups", () => {
  it("credits a confirmed USDG transfer once, and the wallet becomes Builder", async () => {
    const account = newAccount();
    const { cookie } = await signIn(t, account);
    chain.txs.set(hash(1), usdgTx(account.address, 25n * E18));
    const res = await deposit(cookie, hash(1));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "credited",
      asset: "USDG",
      amount: "25",
      usd: 25,
      balanceUsd: 25,
    });

    const again = await deposit(cookie, hash(1));
    expect(again.json()).toMatchObject({ status: "credited", balanceUsd: 25 });
    expect(await t.prisma.deposit.count()).toBe(1);

    const me = (await t.app.inject({ method: "GET", url: "/me", headers: { cookie } })).json();
    expect(me).toMatchObject({
      tier: "builder",
      tierSource: "credits",
      credits: { balanceUsd: 25 },
      keys: { max: null },
    });
    const credits = (await t.app.inject({ method: "GET", url: "/me/credits", headers: { cookie } })).json();
    expect(credits).toMatchObject({
      enabled: true,
      depositAddress: DEPOSIT,
      usdgAddress: USDG,
      ethEnabled: true,
      markup: 1.15,
    });
    expect(credits.deposits).toHaveLength(1);
  });

  it("credits ETH at the Chainlink price", async () => {
    const account = newAccount();
    const { cookie } = await signIn(t, account);
    chain.txs.set(hash(2), {
      status: "success",
      confirmations: 9,
      from: account.address,
      to: DEPOSIT,
      value: E18 / 100n, // 0.01 ETH × $2,500
      transfers: [],
    });
    expect((await deposit(cookie, hash(2))).json()).toMatchObject({ asset: "ETH", amount: "0.01", usd: 25 });
  });

  it("waits for confirmations and refuses bad transactions", async () => {
    const account = newAccount();
    const { cookie } = await signIn(t, account);
    chain.txs.set(hash(3), usdgTx(account.address, E18, 1));
    const pending = await deposit(cookie, hash(3));
    expect(pending.statusCode).toBe(202);
    expect(pending.json()).toEqual({ status: "pending", confirmations: 1, required: 3 });
    expect((await deposit(cookie, hash(99))).statusCode).toBe(202); // not visible yet

    chain.txs.set(hash(4), usdgTx(newAccount().address, E18));
    expect((await deposit(cookie, hash(4))).json().error.code).toBe("wrong_sender");
    chain.txs.set(hash(5), { ...usdgTx(account.address, E18), status: "reverted" });
    expect((await deposit(cookie, hash(5))).json().error.code).toBe("tx_failed");
    chain.txs.set(hash(6), { ...usdgTx(account.address, E18), transfers: [] });
    expect((await deposit(cookie, hash(6))).json().error.code).toBe("no_payment");
    expect((await deposit(cookie, "0x1234")).statusCode).toBe(400);
  });

  it("never credits one transaction to two wallets", async () => {
    const a = newAccount();
    const { cookie } = await signIn(t, a);
    chain.txs.set(hash(7), usdgTx(a.address, E18));
    expect((await deposit(cookie, hash(7))).statusCode).toBe(200);
    const other = await signIn(t);
    expect((await deposit(other.cookie, hash(7))).json().error.code).toBe("already_used");
  });
});

describe("Builder charging", () => {
  it("charges model cost × 1.15 from credit with no daily cap", async () => {
    const { key, walletId } = await builderWithKey(25n);
    const res = await chat(t.app, key, hello("claude-deep"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-dualyne-remaining"]).toBeUndefined();
    const acc = await t.prisma.creditAccount.findUniqueOrThrow({ where: { walletId } });
    // json mode costs $0.0005 = 500 micro → charged ceil(575).
    expect(acc.balanceMicroUsd).toBe(25_000_000n - 575n);
    const log = await t.prisma.usageLog.findFirstOrThrow({ where: { walletId } });
    expect(log.chargedMicroUsd).toBe(575n);
  });

  it("refunds the reservation when the provider fails", async () => {
    const { key, walletId } = await builderWithKey(25n);
    t.upstream.mode = "error";
    t.upstream.errorStatus = 500;
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(502);
    expect((await t.prisma.creditAccount.findUniqueOrThrow({ where: { walletId } })).balanceMicroUsd).toBe(
      25_000_000n,
    );
  });

  it("returns 402 when the credit can't cover the worst case", async () => {
    const { key, walletId } = await builderWithKey(1n);
    await t.prisma.creditAccount.update({ where: { walletId }, data: { balanceMicroUsd: 1000n } });
    const res = await chat(t.app, key, hello("claude-deep", { max_tokens: 4000 }));
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe("insufficient_credits");
  });

  it("falls back to the free tier when credit runs out", async () => {
    const { key, walletId, cookie } = await builderWithKey(1n);
    await t.prisma.creditAccount.update({ where: { walletId }, data: { balanceMicroUsd: 0n } });
    await t.app.ctx.auth.bustWallet(walletId);
    const me = (await t.app.inject({ method: "GET", url: "/me", headers: { cookie } })).json();
    expect(me.tier).toBe("explorer");
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-dualyne-remaining"]).toBe("19");
  });
});
