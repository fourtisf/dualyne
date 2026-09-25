import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, FakeChain, signIn, WEB_ORIGIN, type TestContext } from "./helpers";

const PASS = "0x7777777777777777777777777777777777777777";

const chain = new FakeChain();
let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext(
    { PASS_NFT_ADDRESS: PASS, PRO_CHAT_PER_DAY: "3", PRO_PREMIUM_PER_DAY: "1", SYBIL_CHECK: "off" },
    { chain },
  );
  await t.reset();
  t.upstream.mode = "stream";
  chain.tokenBalances.clear();
  chain.failing = false;
});
afterAll(async () => t?.close());

const holdPass = (address: string, n: bigint) =>
  chain.tokenBalances.set(`${PASS}:${address.toLowerCase()}`, n);
const quota = (cookie: string) =>
  t.app.inject({ method: "GET", url: "/internal/chat/quota", headers: { cookie } }).then((r) => r.json());
const chatAs = (cookie: string, model: string) =>
  t.app.inject({
    method: "POST",
    url: "/internal/chat",
    headers: { cookie },
    payload: { model, messages: [{ role: "user", content: "Hi" }] },
  });

describe("Dualyne Pass holders get Pro", () => {
  it("gives Pro while the wallet holds a Pass, with Pro limits and no end date", async () => {
    const { cookie, account } = await signIn(t);
    holdPass(account.address, 1n);
    expect(await quota(cookie)).toMatchObject({ plan: "pro", pass: true, proUntil: null, limit: 3 });
    expect((await chatAs(cookie, "gpt")).statusCode).toBe(200);
    // Pro's premium allowance still applies.
    expect((await chatAs(cookie, "gemini")).statusCode).toBe(429);

    const pro = await t.app.inject({ method: "GET", url: "/me/pro", headers: { cookie } });
    expect(pro.json()).toMatchObject({ active: true, pass: true, proUntil: null });
  });

  it("stays on the free plan without a Pass, and drops Pro once the Pass is sold", async () => {
    const { cookie, account } = await signIn(t);
    expect((await quota(cookie)).plan).toBe("free");
    expect((await chatAs(cookie, "gpt")).statusCode).toBe(403);

    holdPass(account.address, 2n);
    await t.redis.del(`pass:hold:${account.address.toLowerCase()}`);
    expect((await quota(cookie)).plan).toBe("pro");

    holdPass(account.address, 0n);
    // The balance is cached for 5 minutes; after that the sale shows.
    expect((await quota(cookie)).plan).toBe("pro");
    await t.redis.del(`pass:hold:${account.address.toLowerCase()}`);
    expect((await quota(cookie)).plan).toBe("free");
  });

  it("re-reads the balance right after a mint when the site asks", async () => {
    const { cookie, account } = await signIn(t);
    expect((await quota(cookie)).plan).toBe("free");
    holdPass(account.address, 1n);
    const refresh = (headers: Record<string, string>) =>
      t.app.inject({ method: "POST", url: "/me/pass/refresh", headers });
    expect((await refresh({ cookie })).statusCode).toBe(403);
    expect((await refresh({ origin: WEB_ORIGIN })).statusCode).toBe(401);
    const res = await refresh({ cookie, origin: WEB_ORIGIN });
    expect(res.json()).toEqual({ pass: true });
    expect((await quota(cookie)).plan).toBe("pro");
  });

  it("keeps the last known answer when the RPC is down", async () => {
    const { cookie, account } = await signIn(t);
    holdPass(account.address, 1n);
    expect((await quota(cookie)).plan).toBe("pro");
    await t.redis.del(`pass:hold:${account.address.toLowerCase()}`);
    chain.failing = true;
    expect((await quota(cookie)).plan).toBe("pro");
  });
});

describe("GET /pass", () => {
  it("reports the sale from the contract", async () => {
    const res = await t.app.inject({ method: "GET", url: "/pass" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      address: PASS,
      chainId: 1,
      priceWei: "10000000000000000",
      minted: 12,
      maxSupply: 500,
      maxPerWallet: 5,
      mintOpen: true,
    });
  });

  it("still answers when the chain can't be read", async () => {
    chain.failing = true;
    const res = await t.app.inject({ method: "GET", url: "/pass" });
    expect(res.json()).toMatchObject({ enabled: true, address: PASS, priceWei: null, mintOpen: false });
  });
});
