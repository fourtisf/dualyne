import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { defaultJobs } from "../src/jobs/scheduler";
import { createTestContext, type TestContext } from "./helpers";

const TOKEN = `123456:${"A".repeat(35)}`;

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42" });
  await t.reset();
  t.upstream.mode = "stream";
});
afterAll(async () => t?.close());

const creditCheck = () =>
  defaultJobs(t.app)
    .find((j) => j.name === "credit-check")!
    .run();
const messages = () => t.upstream.telegram.map((m) => String(m.body.text));

describe("alerts to Telegram", () => {
  it("sends to the configured chat with the bot token", async () => {
    await t.app.ctx.alert("hello");
    expect(t.upstream.telegram).toHaveLength(1);
    expect(t.upstream.telegram[0]!.token).toBe(TOKEN);
    expect(t.upstream.telegram[0]!.body).toMatchObject({ chat_id: "42", text: "⚠️ Dualyne: hello" });
  });

  it("warns once a day when OpenRouter credit is low", async () => {
    t.upstream.credits = { total_credits: 10, total_usage: 9 };
    await creditCheck();
    await creditCheck();
    expect(messages()).toEqual([
      "⚠️ Dualyne: OpenRouter credit is low: $1.00 left. Top up at https://openrouter.ai/settings/credits",
    ]);
  });

  it("uses the key's own limit when that is smaller", async () => {
    t.upstream.credits = { total_credits: 100, total_usage: 0 };
    t.upstream.keyInfo = { limit_remaining: 0.5 };
    await creditCheck();
    expect(messages()[0]).toContain("$0.50 left");
  });

  it("stays quiet with enough credit, or when OpenRouter doesn't say", async () => {
    t.upstream.credits = { total_credits: 10, total_usage: 1 };
    t.upstream.keyInfo = { limit_remaining: null };
    await creditCheck();
    t.upstream.credits = null;
    t.upstream.keyInfo = null;
    await creditCheck();
    expect(messages()).toEqual([]);
  });

  it("reports an out-of-credits OpenRouter at most once an hour", async () => {
    t.upstream.mode = "error";
    t.upstream.errorStatus = 402;
    for (let i = 0; i < 3; i++) {
      await t.app.inject({
        method: "POST",
        url: "/internal/chat",
        payload: { model: "llama", messages: [{ role: "user", content: "Hi" }], turnstileToken: "good-chat" },
      });
    }
    await Promise.all([...t.app.ctx.inflight]);
    await new Promise((r) => setTimeout(r, 50));
    expect(messages().filter((m) => m.includes("out of credits"))).toHaveLength(1);
  });
});
