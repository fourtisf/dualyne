import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyProPayment } from "../src/pro";
import {
  createTestContext,
  fakeIdToken,
  fakeMailer,
  newAccount,
  siweMessage,
  signIn,
  WEB_ORIGIN,
  type TestContext,
} from "./helpers";

const mailer = fakeMailer();
let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext(
    {
      GOOGLE_CLIENT_ID: "client-123",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_AUTH_URL: "https://accounts.example/auth",
      API_PUBLIC_URL: "https://api.test",
      REFERRAL_PRO_DAYS: "7",
    },
    { mailer },
  );
  t.upstream.googleIdToken = null;
  await t.reset();
  mailer.sent.length = 0;
  // The Google token endpoint lives on the fake upstream (its URL is only known now).
  (t.app.ctx.env as { GOOGLE_TOKEN_URL: string }).GOOGLE_TOKEN_URL = `${t.upstream.url}/google/token`;
});
afterAll(async () => t?.close());

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: "POST",
    url,
    payload: payload as object,
    headers: { origin: WEB_ORIGIN, ...headers },
  });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers["set-cookie"]).match(/dly_session=[^;]+/)?.[0] ?? "";
const lastCode = () => mailer.sent.at(-1)!.subject.match(/^(\d{6})/)![1]!;

describe("email sign-in", () => {
  it("lists the sign-in methods that are set up", async () => {
    const res = await t.app.inject({ method: "GET", url: "/auth/methods" });
    expect(res.json()).toEqual({ wallet: true, email: true, google: true });
  });

  it("sends a code and signs in with it, once", async () => {
    expect((await post("/auth/email/start", { email: "Ana@Example.com" })).statusCode).toBe(204);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("ana@example.com");
    const code = lastCode();

    const wrong = await post("/auth/email/verify", {
      email: "ana@example.com",
      code: code === "000000" ? "111111" : "000000",
    });
    expect(wrong.json().error.code).toBe("wrong_code");

    const res = await post("/auth/email/verify", { email: "ana@example.com", code });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ address: null, email: "ana@example.com", google: false });
    const session = await t.app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: cookieOf(res) },
    });
    expect(session.json().me.email).toBe("ana@example.com");

    const again = await post("/auth/email/verify", { email: "ana@example.com", code });
    expect(again.json().error.code).toBe("code_expired");
    // Signing in again later finds the same account.
    await post("/auth/email/start", { email: "ana@example.com" });
    await post("/auth/email/verify", { email: "ana@example.com", code: lastCode() });
    expect(await t.prisma.wallet.count()).toBe(1);
  });

  it("stops guessing after 5 wrong codes, and needs the website origin", async () => {
    await post("/auth/email/start", { email: "bo@example.com" });
    const code = lastCode();
    const bad = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await post("/auth/email/verify", { email: "bo@example.com", code: bad });
    const res = await post("/auth/email/verify", { email: "bo@example.com", code });
    expect(res.json().error.code).toBe("too_many_attempts");
    const noOrigin = await t.app.inject({
      method: "POST",
      url: "/auth/email/start",
      payload: { email: "bo@example.com" },
    });
    expect(noOrigin.statusCode).toBe(403);
  });

  it("links a wallet to an email account", async () => {
    await post("/auth/email/start", { email: "cy@example.com" });
    const res = await post("/auth/email/verify", { email: "cy@example.com", code: lastCode() });
    const cookie = cookieOf(res);
    const account = newAccount();
    const message = await siweMessage(t, account);
    const linked = await post(
      "/auth/verify",
      { message, signature: await account.signMessage({ message }) },
      { cookie },
    );
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ email: "cy@example.com", address: account.address.toLowerCase() });
    expect(await t.prisma.wallet.count()).toBe(1);
  });
});

describe("Google sign-in", () => {
  const claims = {
    iss: "https://accounts.google.com",
    aud: "client-123",
    sub: "g-42",
    email: "Dee@Gmail.com",
    email_verified: true,
    exp: Math.floor(new Date("2026-09-23T13:00:00Z").getTime() / 1000),
  };

  async function start(query = "") {
    const res = await t.app.inject({ method: "GET", url: `/auth/google/start${query}` });
    expect(res.statusCode).toBe(302);
    const to = new URL(String(res.headers.location));
    const stateCookie = String(res.headers["set-cookie"]).match(/dly_gstate=[^;]+/)![0];
    return { to, state: to.searchParams.get("state")!, stateCookie };
  }

  it("redirects to Google and back, creating the account", async () => {
    const { to, state, stateCookie } = await start("?return=/chat");
    expect(to.origin + to.pathname).toBe("https://accounts.example/auth");
    expect(to.searchParams.get("redirect_uri")).toBe("https://api.test/auth/google/callback");
    t.upstream.googleIdToken = fakeIdToken(claims);
    const res = await t.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=abc&state=${state}`,
      headers: { cookie: stateCookie },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/chat?signed_in=1");
    expect(cookieOf(res)).toMatch(/^dly_session=/);
    const w = await t.prisma.wallet.findFirstOrThrow();
    expect(w).toMatchObject({ googleSub: "g-42", email: "dee@gmail.com", address: null });
  });

  it("refuses a missing or wrong state, and tokens for another app", async () => {
    const { state, stateCookie } = await start();
    t.upstream.googleIdToken = fakeIdToken(claims);
    const noCookie = await t.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=abc&state=${state}`,
    });
    expect(noCookie.headers.location).toBe("http://localhost:3000/chat?login_error=google");

    const second = await start();
    t.upstream.googleIdToken = fakeIdToken({ ...claims, aud: "someone-else" });
    const wrongAud = await t.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=abc&state=${second.state}`,
      headers: { cookie: second.stateCookie },
    });
    expect(wrongAud.headers.location).toBe("http://localhost:3000/chat?login_error=google");
    void stateCookie;
    expect(await t.prisma.wallet.count()).toBe(0);
  });

  it("joins the email account with the same address", async () => {
    await post("/auth/email/start", { email: "dee@gmail.com" });
    await post("/auth/email/verify", { email: "dee@gmail.com", code: lastCode() });
    const { state, stateCookie } = await start();
    t.upstream.googleIdToken = fakeIdToken(claims);
    await t.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=abc&state=${state}`,
      headers: { cookie: stateCookie },
    });
    const all = await t.prisma.wallet.findMany();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ email: "dee@gmail.com", googleSub: "g-42" });
  });
});

describe("referrals", () => {
  it("credits the inviter with Pro days once, when the invited account first pays", async () => {
    const inviter = await signIn(t);
    const link = (
      await t.app.inject({ method: "GET", url: "/me/referral", headers: { cookie: inviter.cookie } })
    ).json();
    expect(link.code).toMatch(/^[2-9A-Z]{8}$/);
    expect(link.link).toBe(`https://dualyne.com/?ref=${link.code}`);

    await post("/auth/email/start", { email: "new@example.com" });
    await post("/auth/email/verify", { email: "new@example.com", code: lastCode(), ref: link.code });
    const invited = await t.prisma.wallet.findUniqueOrThrow({ where: { email: "new@example.com" } });
    expect(invited.referredById).not.toBeNull();

    const pay = (txHash: string) =>
      applyProPayment(t.app.ctx, invited, {
        txHash,
        asset: "USDC",
        amount: "19",
        usdMicro: 19_000_000n,
        periods: 1,
      });
    await pay("0x01");
    await pay("0x02");
    const inviterRow = await t.prisma.wallet.findUniqueOrThrow({ where: { id: invited.referredById! } });
    expect(inviterRow.proUntil!.getTime() - t.now.value.getTime()).toBe(7 * 86_400_000);

    const stats = (
      await t.app.inject({ method: "GET", url: "/me/referral", headers: { cookie: inviter.cookie } })
    ).json();
    expect(stats).toMatchObject({ joined: 1, upgraded: 1, daysEarned: 7, rewardDays: 7 });
  });

  it("ignores unknown codes", async () => {
    await post("/auth/email/start", { email: "x@example.com" });
    const res = await post("/auth/email/verify", {
      email: "x@example.com",
      code: lastCode(),
      ref: "NOPE2345",
    });
    expect(res.statusCode).toBe(200);
    expect((await t.prisma.wallet.findFirstOrThrow()).referredById).toBeNull();
  });
});

describe("chat sync", () => {
  const chat = (updatedAt: number, content = "Hi") => ({
    title: "Hello",
    updatedAt,
    turns: [
      { role: "user", content, attachments: [{ kind: "image", name: "a.png", gone: true }] },
      {
        role: "assistant",
        content: "Hello!",
        model: "llama",
        sources: [{ url: "https://a.example/", title: "A" }],
      },
    ],
  });
  const put = (cookie: string, id: string, body: unknown) =>
    t.app.inject({
      method: "PUT",
      url: `/me/chats/${id}`,
      payload: body as object,
      headers: { cookie, origin: WEB_ORIGIN },
    });
  const list = (cookie: string) => t.app.inject({ method: "GET", url: "/me/chats", headers: { cookie } });

  it("saves, lists, keeps the newest copy and deletes", async () => {
    const { cookie } = await signIn(t);
    const id = "3f2c9d1e-aaaa-bbbb-cccc-123456789abc";
    const now = t.now.value.getTime();
    expect((await put(cookie, id, chat(now - 1000, "First"))).statusCode).toBe(204);
    expect((await put(cookie, id, chat(now - 5000, "Older"))).statusCode).toBe(204);
    const got = (await list(cookie)).json().chats;
    expect(got).toHaveLength(1);
    expect(got[0].turns[0].content).toBe("First");
    expect(got[0].turns[0].attachments[0]).toEqual({ kind: "image", name: "a.png", gone: true });

    const del = await t.app.inject({
      method: "DELETE",
      url: `/me/chats/${id}`,
      headers: { cookie, origin: WEB_ORIGIN },
    });
    expect(del.statusCode).toBe(204);
    expect((await list(cookie)).json().chats).toHaveLength(0);
  });

  it("never stores file contents, and each account sees only its own chats", async () => {
    const a = await signIn(t);
    const b = await signIn(t);
    const withData = chat(t.now.value.getTime());
    (withData.turns[0] as Record<string, unknown>).attachments = [
      { kind: "image", name: "a.png", data: "data:image/png;base64,AAAA" },
    ];
    expect((await put(a.cookie, "chat-00000001", withData)).statusCode).toBe(400);
    await put(a.cookie, "chat-00000001", chat(t.now.value.getTime()));
    expect((await list(b.cookie)).json().chats).toHaveLength(0);
    expect((await list("")).statusCode).toBe(401);
  });
});
