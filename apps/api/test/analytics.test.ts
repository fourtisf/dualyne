import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cleanPath, lastDays, refDomain, summarize } from "../src/analytics/visits";
import { TelegramBot } from "../src/telegram/bot";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext();
  await t.reset();
});
afterAll(async () => t?.close());

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const view = (payload: unknown, opts: { ip?: string; ua?: string } = {}) =>
  t.app.inject({
    method: "POST",
    url: "/internal/pv",
    payload: payload as Record<string, unknown>,
    remoteAddress: opts.ip ?? "203.0.113.7",
    headers: { "user-agent": opts.ua ?? BROWSER },
  });
const today = () => summarize(t.redis, lastDays(t.now.value, 1));

describe("visit counts (cookieless)", () => {
  it("counts views, unique visitors, pages and referring sites", async () => {
    expect((await view({ path: "/", ref: "https://x.com/DualyneAi/status/1" })).statusCode).toBe(204);
    await view({ path: "/chat?q=hello" }); // same person, another page
    await view({ path: "/" }, { ip: "198.51.100.2" }); // someone else
    await view(
      { path: "/models/GPT/", ref: "https://www.google.com/search?q=dualyne" },
      { ip: "198.51.100.3" },
    );

    const s = await today();
    expect(s.views).toBe(4);
    expect(s.visitors).toBe(3);
    expect(s.pages).toEqual([
      ["/", 2],
      ["/chat", 1],
      ["/models/gpt", 1],
    ]);
    expect(s.refs.map(([k]) => k).sort()).toEqual(["google.com", "x.com"]);
  });

  it("stores no IP address and sets no cookie", async () => {
    const res = await view({ path: "/" }, { ip: "192.0.2.55" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    const keys = await t.redis.keys("pv:*");
    for (const k of keys) {
      const type = await t.redis.type(k);
      const dump =
        type === "zset"
          ? (await t.redis.zrange(k, 0, -1)).join(" ")
          : type === "string"
            ? String(await t.redis.get(k))
            : "";
      expect(dump).not.toContain("192.0.2.55");
      expect(await t.redis.ttl(k)).toBeGreaterThan(80 * 86_400);
    }
  });

  it("ignores bots and our own domain as a referrer", async () => {
    await view({ path: "/" }, { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    await view({ path: "/" }, { ua: "" });
    await view({ path: "/docs", ref: "https://dualyne.com/" });
    const s = await today();
    expect(s.views).toBe(1);
    expect(s.refs).toEqual([]);
  });

  it("validates the body", async () => {
    expect((await view({ path: "/", extra: 1 })).statusCode).toBe(400);
    expect((await view({ path: "x".repeat(400) })).statusCode).toBe(400);
    expect((await view({})).statusCode).toBe(400);
  });

  it("cleans paths and referrers", () => {
    expect(cleanPath("/Models/Claude-Swift/?a=1#b")).toBe("/models/claude-swift");
    expect(cleanPath("/<script>")).toBe("/other");
    expect(cleanPath("")).toBe("/");
    expect(refDomain("https://t.me/dualynebot", "dualyne.com")).toBe("t.me");
    expect(refDomain("https://api.dualyne.com/x", "dualyne.com")).toBeNull();
    expect(refDomain("not a url", "dualyne.com")).toBeNull();
  });
});

describe("/stats in the owner's Telegram chat", () => {
  const cfg = () => ({ token: `123456:${"C".repeat(35)}`, ownerChatId: "42", apiUrl: t.upstream.url });
  const msg = (chat: number, text: string) => ({
    update_id: Date.now(),
    message: { message_id: 1, chat: { id: chat, type: "private" }, from: { id: chat }, text },
  });
  const sent = () =>
    t.upstream.telegram.filter((m) => m.method === "sendMessage").map((m) => String(m.body.text));

  it("reports visitors, pages, referrers and chats to the owner only", async () => {
    await view({ path: "/", ref: "https://x.com/a" });
    await view({ path: "/chat" }, { ip: "198.51.100.9" });
    const bot = new TelegramBot(t.app.ctx, t.app.log, cfg());
    await bot.handle(msg(42, "/stats"));
    const text = sent()[0]!;
    expect(text).toContain("<b>Dualyne stats</b>");
    expect(text).toMatch(/Today \(UTC\)<\/b>\n👤 2 visitors · 2 page views/);
    expect(text).toContain("  /: 1");
    expect(text).toContain("  x.com: 1");

    await t.redis.del("tgbot:gap:7");
    await bot.handle(msg(7, "/stats"));
    expect(sent()[1]).toBe("I don't know that command. Send /help to see what I can do.");
  });
});
