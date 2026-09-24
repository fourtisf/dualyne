import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, parseSse, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ CHAT_LIMIT_PER_HOUR: "2" });
  await t.reset();
  t.upstream.mode = "stream";
  t.now.value = new Date("2026-09-23T12:00:00Z");
});
afterAll(async () => t?.close());

const send = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "POST", url: "/internal/chat", payload, headers });
const good = {
  model: "llama",
  messages: [
    { role: "user", content: "What is an AMM?" },
    { role: "assistant", content: "A pool of two tokens." },
    { role: "user", content: "Shorter, please." },
  ],
  turnstileToken: "good-chat",
};

describe("POST /internal/chat", () => {
  it("streams one model's answer to the whole conversation", async () => {
    const res = await send(good);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["x-chat-remaining"]).toBe("1");
    const events = parseSse(res.body);
    expect(events[0]).toMatchObject({ event: "meta", data: JSON.stringify({ model: "llama" }) });
    const text = events
      .filter((e) => e.event === "delta")
      .map((e) => JSON.parse(e.data).text)
      .join("");
    expect(text).toBe("Hello ✓");
    expect(events.find((e) => e.event === "done")).toBeTruthy();
    expect(events.at(-1)!.event).toBe("end");

    const upstream = t.upstream.requests[0]!.body;
    expect(upstream.model).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(upstream.max_tokens).toBe(1000);
    expect(upstream.messages).toEqual(good.messages);
  });

  it("logs usage as chat with a hashed IP and no text", async () => {
    await send(good);
    const [log] = await t.prisma.usageLog.findMany();
    expect(log).toMatchObject({ source: "chat", modelId: "llama", status: 200, compareId: null });
    expect(log!.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain("AMM");
  });

  it("only offers the free (explorer) models", async () => {
    const res = await send({ ...good, model: "gpt" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("model_not_allowed");
    expect((await send({ ...good, model: "nope" })).statusCode).toBe(404);
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("limits each IP per hour", async () => {
    expect((await send(good)).statusCode).toBe(200);
    expect((await send(good)).statusCode).toBe(200);
    const res = await send(good);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("rate_limited");
    expect(res.headers["x-chat-remaining"]).toBe("0");
  });

  it("validates the conversation", async () => {
    const lastIsAssistant = { ...good, messages: good.messages.slice(0, 2) };
    expect((await send(lastIsAssistant)).statusCode).toBe(400);
    expect((await send({ ...good, messages: [] })).statusCode).toBe(400);
    const tooMany = Array.from({ length: 21 }, () => ({ role: "user", content: "hi" }));
    expect((await send({ ...good, messages: tooMany })).statusCode).toBe(400);
    const tooLong = [1, 2, 3, 4].map(() => ({ role: "user", content: "x".repeat(7000) }));
    expect((await send({ ...good, messages: tooLong })).statusCode).toBe(400);
    expect((await send({ ...good, messages: [{ role: "system", content: "hi" }] })).statusCode).toBe(400);
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("checks Turnstile when it is configured, for the chat action", async () => {
    for (const token of ["bad", "good"]) {
      const res = await send({ ...good, turnstileToken: token });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("turnstile_failed");
    }
  });

  it("stops at the daily budget", async () => {
    await t.redis.set(`spend:2026-09-23`, String(10 ** 12));
    const res = await send(good);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("budget_exhausted");
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("reports an upstream failure in the stream", async () => {
    t.upstream.mode = "midstream-error";
    const events = parseSse((await send(good)).body);
    expect(events.some((e) => e.event === "error")).toBe(true);
    expect(events.at(-1)!.event).toBe("end");
  });

  it("is callable from the website's origin only", async () => {
    const ok = await send(good, { origin: "http://localhost:3000" });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const evil = await send(good, { origin: "https://evil.example" });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
