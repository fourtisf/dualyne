import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  chat,
  createTestContext,
  FakeChain,
  hello,
  newAccount,
  signIn,
  siweMessage,
  WEB_ORIGIN,
  type TestContext,
} from "./helpers";

const chain = new FakeChain();
let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ SYBIL_CHECK: "on", SYBIL_MIN_WALLET_AGE_DAYS: "30" }, { chain });
  await t.reset();
  t.upstream.mode = "json";
  t.now.value = new Date("2026-09-23T12:00:00Z");
  chain.balances.clear();
  chain.firstTx.clear();
  chain.failing = false;
});
afterAll(async () => t?.close());

const me = (cookie: string, url = "/me") => t.app.inject({ method: "GET", url, headers: { cookie } });
const createKey = (cookie: string, body: Record<string, unknown> = {}) =>
  t.app.inject({ method: "POST", url: "/me/keys", headers: { cookie, origin: WEB_ORIGIN }, payload: body });
const rich = (address: string) => chain.balances.set(address.toLowerCase(), 10n ** 18n);

describe("Sign-In With Ethereum", () => {
  it("signs in with a valid message and sets an HttpOnly session cookie", async () => {
    const account = newAccount();
    const message = await siweMessage(t, account);
    const signature = await account.signMessage({ message });
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/verify",
      headers: { origin: WEB_ORIGIN },
      payload: { message, signature },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ address: account.address.toLowerCase(), tier: "explorer" });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/^dly_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // Only an HMAC of the token is stored.
    const token = cookie.split(";")[0]!.split("=")[1]!;
    const rows = await t.prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toContain(token);
  });

  it("rejects a signature from a different wallet", async () => {
    const account = newAccount();
    const message = await siweMessage(t, account);
    const signature = await newAccount().signMessage({ message });
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/verify",
      headers: { origin: WEB_ORIGIN },
      payload: { message, signature },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("siwe_invalid");
  });

  it("rejects replayed nonces, other domains, other chains and stale messages", async () => {
    const account = newAccount();
    const post = async (message: string) =>
      t.app.inject({
        method: "POST",
        url: "/auth/verify",
        headers: { origin: WEB_ORIGIN },
        payload: { message, signature: await account.signMessage({ message }) },
      });

    const good = await siweMessage(t, account);
    expect((await post(good)).statusCode).toBe(200);
    expect((await post(good)).statusCode).toBe(401); // nonce already used

    expect((await post(await siweMessage(t, account, { domain: "evil.example" }))).statusCode).toBe(401);
    expect((await post(await siweMessage(t, account, { uri: "https://evil.example" }))).statusCode).toBe(401);
    expect((await post(await siweMessage(t, account, { chainId: 8453 }))).statusCode).toBe(401);
    const old = new Date(t.now.value.getTime() - 11 * 60_000);
    expect((await post(await siweMessage(t, account, { issuedAt: old }))).statusCode).toBe(401);
    const unknownNonce = (await siweMessage(t, account)).replace(/Nonce: \w+/, "Nonce: abcdef1234567890");
    expect((await post(unknownNonce)).statusCode).toBe(401);
  });

  it("requires the website's Origin for sign-in (CSRF)", async () => {
    const account = newAccount();
    const message = await siweMessage(t, account);
    const res = await t.app.inject({
      method: "POST",
      url: "/auth/verify",
      headers: { origin: "https://evil.example" },
      payload: { message, signature: await account.signMessage({ message }) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("reports the session without errors when signed out", async () => {
    const out = await t.app.inject({ method: "GET", url: "/auth/session" });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ me: null });
    const { cookie, account } = await signIn(t);
    const inn = await t.app.inject({ method: "GET", url: "/auth/session", headers: { cookie } });
    expect(inn.json().me.address).toBe(account.address.toLowerCase());
  });

  it("logs out and the session stops working", async () => {
    const { cookie } = await signIn(t);
    expect((await me(cookie)).statusCode).toBe(200);
    const out = await t.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie, origin: WEB_ORIGIN },
    });
    expect(out.statusCode).toBe(204);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("expires sessions after 30 days", async () => {
    const { cookie } = await signIn(t);
    t.now.value = new Date(t.now.value.getTime() + 31 * 86_400_000);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("allows credentialed CORS only for the website origin", async () => {
    const res = await t.app.inject({
      method: "OPTIONS",
      url: "/me/keys",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("self-serve API keys", () => {
  it("creates a key once, lists it without the secret, and the key works on /v1", async () => {
    const { cookie, account } = await signIn(t);
    rich(account.address);
    const created = await createKey(cookie, { name: "my bot" });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.key).toMatch(/^dly_live_[0-9a-f]{32}$/);
    expect(body.last4).toBe(body.key.slice(-4));

    const list = (await me(cookie, "/me/keys")).json();
    expect(list.data).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(body.key);

    expect((await chat(t.app, body.key, hello("claude-swift"))).statusCode).toBe(200);
    const usage = (await me(cookie, "/me/usage?days=7")).json();
    expect(usage.days).toHaveLength(7);
    expect(usage.days.at(-1)).toMatchObject({ day: "2026-09-23", requests: 1 });
    expect(usage.byKey[0]).toMatchObject({ name: "my bot", requests: 1 });
    expect((await me(cookie)).json()).toMatchObject({
      usage: { today: 1, remaining: 19 },
      keys: { count: 1, max: 1 },
    });
  });

  it("enforces key limits per tier (Explorer 1, Holder 5)", async () => {
    const { cookie, account } = await signIn(t);
    rich(account.address);
    expect((await createKey(cookie)).statusCode).toBe(201);
    const second = await createKey(cookie);
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe("key_limit");

    await t.prisma.wallet.update({
      where: { address: account.address.toLowerCase() },
      data: { tierOverride: "holder" },
    });
    for (let i = 0; i < 4; i++) expect((await createKey(cookie)).statusCode).toBe(201);
    expect((await createKey(cookie)).statusCode).toBe(403);
  });

  it("revokes a key: it stops working on the next request", async () => {
    const { cookie, account } = await signIn(t);
    rich(account.address);
    const { id, key } = (await createKey(cookie)).json();
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(200);
    const del = await t.app.inject({
      method: "DELETE",
      url: `/me/keys/${id}`,
      headers: { cookie, origin: WEB_ORIGIN },
    });
    expect(del.statusCode).toBe(204);
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(401);
  });

  it("cannot revoke another wallet's key", async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    rich(a.account.address);
    const { id } = (await createKey(a.cookie)).json();
    const del = await t.app.inject({
      method: "DELETE",
      url: `/me/keys/${id}`,
      headers: { cookie: b.cookie, origin: WEB_ORIGIN },
    });
    expect(del.statusCode).toBe(404);
    expect(await t.prisma.apiKey.count()).toBe(1);
  });

  it("requires a session and the website origin", async () => {
    expect((await t.app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    const { cookie } = await signIn(t);
    const res = await t.app.inject({ method: "POST", url: "/me/keys", headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe("sybil check for free Explorer keys", () => {
  it("refuses a new, empty wallet and explains why", async () => {
    const { cookie } = await signIn(t);
    const res = await createKey(cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("not_eligible");
    expect(res.json().error.message).toContain("0.001 ETH");
    expect((await me(cookie)).json().eligibility).toMatchObject({
      eligible: false,
      code: "requirement",
      requirement: { minEth: 0.001, minAgeDays: expect.any(Number) },
    });
  });

  it("accepts a wallet with enough balance", async () => {
    const { cookie, account } = await signIn(t);
    rich(account.address);
    expect((await createKey(cookie)).statusCode).toBe(201);
  });

  it("accepts an old wallet even with no balance", async () => {
    const { cookie, account } = await signIn(t);
    chain.firstTx.set(account.address.toLowerCase(), t.now.value.getTime() / 1000 - 90 * 86400);
    expect((await createKey(cookie)).statusCode).toBe(201);
  });

  it("does not apply to Holder wallets", async () => {
    const { cookie, account } = await signIn(t);
    await t.prisma.wallet.update({
      where: { address: account.address.toLowerCase() },
      data: { tierOverride: "holder" },
    });
    expect((await createKey(cookie)).statusCode).toBe(201);
  });

  it("asks to retry (and caches nothing) when the chain is unreachable", async () => {
    const { cookie, account } = await signIn(t);
    chain.failing = true;
    const res = await createKey(cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Try again");
    chain.failing = false;
    rich(account.address);
    expect((await createKey(cookie)).statusCode).toBe(201);
  });
});
