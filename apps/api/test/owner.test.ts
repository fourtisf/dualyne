import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateApiKey } from "../src/auth/apiKey";
import { chat, createTestContext, hello, newAccount, signIn, type TestContext } from "./helpers";

const owner = newAccount();
let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext({
    OWNER_ACCOUNTS: ` ${owner.address.toUpperCase().replace("0X", "0x")} , boss@example.com`,
    TIER_EXPLORER_DAILY: "1",
    CHAT_LIMIT_PER_DAY: "1",
    WEB_SEARCH_FREE_PER_DAY: "0",
  });
  await t.reset();
  t.upstream.mode = "json";
});
afterAll(async () => t?.close());

async function ownerKey(): Promise<string> {
  const wallet = await t.prisma.wallet.create({ data: { address: owner.address.toLowerCase() } });
  const { key, hash, last4 } = generateApiKey();
  await t.prisma.apiKey.create({ data: { walletId: wallet.id, hash, last4 } });
  return key;
}

describe("owner account (OWNER_ACCOUNTS)", () => {
  it("has no API cap, every model, and is never charged", async () => {
    const key = await ownerKey();
    for (let i = 0; i < 3; i++) expect((await chat(t.app, key, hello("gpt"))).statusCode).toBe(200);
    expect(await t.prisma.creditAccount.count()).toBe(0);
    const { cookie } = await signIn(t, owner);
    const me = (await t.app.inject({ method: "GET", url: "/me", headers: { cookie } })).json();
    expect(me).toMatchObject({ tier: "builder", tierLabel: "Owner", tierSource: "owner" });
    expect(me.limits.dailyRequests).toBeNull();
    expect(typeof me.id).toBe("string");
  });

  it("chats with premium models, web search and no daily limit", async () => {
    t.upstream.mode = "stream";
    const { cookie } = await signIn(t, owner);
    const send = () =>
      t.app.inject({
        method: "POST",
        url: "/internal/chat",
        headers: { cookie },
        payload: { model: "gpt", webSearch: true, messages: [{ role: "user", content: "Hi" }] },
      });
    for (let i = 0; i < 3; i++) expect((await send()).statusCode).toBe(200);
    const quota = (
      await t.app.inject({ method: "GET", url: "/internal/chat/quota", headers: { cookie } })
    ).json();
    expect(quota.plan).toBe("owner");
  });

  it("is only the listed accounts: everyone else keeps the normal limits", async () => {
    t.upstream.mode = "stream";
    const { cookie } = await signIn(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/internal/chat",
      headers: { cookie },
      payload: { model: "gpt", messages: [{ role: "user", content: "Hi" }], turnstileToken: "good-chat" },
    });
    expect(res.statusCode).toBe(403);
    const quota = (
      await t.app.inject({ method: "GET", url: "/internal/chat/quota", headers: { cookie } })
    ).json();
    expect(quota.plan).toBe("free");
  });
});
