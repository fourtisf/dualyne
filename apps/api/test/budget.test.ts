import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chat, createKey, createTestContext, hello, type TestContext } from "./helpers";

// Cap of $0.01 = 10,000 micro-USD. One explorer claude-swift request reserves ~5,010
// (1,000 output tokens × $5/M + a few input tokens) and really costs $0.0005 (500) in json mode.
const CAP_MICRO = 10_000;
const DAY_KEY = "spend:2026-09-23";
const HELD_KEY = "held:2026-09-23";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ DAILY_BUDGET_USD: "0.01" });
  await t.reset();
  t.upstream.mode = "json";
  t.now.value = new Date("2026-09-23T12:00:00Z");
});
afterAll(async () => t?.close());

describe("global daily budget cap", () => {
  it("settles the reservation to the real cost reported by OpenRouter", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(200);
    expect(await t.redis.get(DAY_KEY)).toBe("500");
    const log = await t.prisma.usageLog.findFirstOrThrow();
    expect(log.costMicroUsd).toBe(500n);
  });

  it("returns 429 to free tiers once the cap is hit, until 00:00 UTC", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    await t.redis.set(DAY_KEY, String(CAP_MICRO));
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("budget_exhausted");
    expect(Number(res.headers["retry-after"])).toBe(12 * 3600);
    expect(t.upstream.requests).toHaveLength(0);

    const holder = await createKey(t.prisma, "holder", `0x${"d".repeat(40)}`);
    expect((await chat(t.app, holder.key, hello("claude-swift"))).statusCode).toBe(429);

    t.now.value = new Date("2026-09-24T00:00:00Z");
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(200);
  });

  it("refuses a free request whose worst case would cross the cap", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    await t.redis.set(DAY_KEY, String(CAP_MICRO - 1000));
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(429);
    expect(await t.redis.get(DAY_KEY)).toBe(String(CAP_MICRO - 1000)); // reservation rolled back
  });

  it("keeps paid Builder requests working after the cap", async () => {
    const { key } = await createKey(t.prisma, "builder");
    await t.redis.set(DAY_KEY, String(CAP_MICRO * 5));
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(200);
  });

  it("does not consume quota when the budget refuses", async () => {
    const { key, address } = await createKey(t.prisma, "explorer");
    await t.redis.set(DAY_KEY, String(CAP_MICRO));
    await chat(t.app, key, hello("claude-swift"));
    expect(await t.redis.get(`quota:${address}:2026-09-23`)).toBeNull();
  });

  it("never lets concurrent free requests push spend past the cap", async () => {
    const keys = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createKey(t.prisma, "explorer", `0x${String(i).repeat(40)}`)),
    );
    const results = await Promise.all(keys.map((k) => chat(t.app, k.key, hello("claude-swift"))));
    const ok = results.filter((r) => r.statusCode === 200).length;
    expect(ok).toBeGreaterThan(0);
    expect(Number(await t.redis.get(DAY_KEY))).toBeLessThanOrEqual(CAP_MICRO);
    // Every refusal during the burst was "busy" (budget left, held in flight), never "exhausted".
    for (const r of results.filter((x) => x.statusCode === 429)) {
      expect(r.json().error.code).toBe("budget_busy");
    }
    expect(await t.redis.get(HELD_KEY)).toBe("0"); // all holds released
  });

  it("releases the in-flight hold when a request settles", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    await chat(t.app, key, hello("claude-swift"));
    expect(await t.redis.get(DAY_KEY)).toBe("500");
    expect(await t.redis.get(HELD_KEY)).toBe("0");
  });

  it("answers 'busy' (retry in seconds) when in-flight requests hold the remaining budget", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    // 9,000 counted, 8,000 of it only reserved by requests still running: 1,000 really spent.
    await t.redis.set(DAY_KEY, String(CAP_MICRO - 1000));
    await t.redis.set(HELD_KEY, String(CAP_MICRO - 2000));
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("budget_busy");
    expect(Number(res.headers["retry-after"])).toBe(10);
    expect(await t.redis.get(DAY_KEY)).toBe(String(CAP_MICRO - 1000));
    expect(await t.redis.get(HELD_KEY)).toBe(String(CAP_MICRO - 2000));
    expect(await t.app.ctx.budget.isExhausted()).toBe(false);

    // Once the running requests settle to their real cost, the same request goes through.
    await t.redis.set(DAY_KEY, "1400");
    await t.redis.set(HELD_KEY, "0");
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(200);
  });

  it("rebuilds the day's spend from the usage log if Redis loses it", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    await chat(t.app, key, hello("claude-swift"));
    await chat(t.app, key, hello("claude-swift"));
    await t.redis.del(DAY_KEY);
    expect(await t.app.ctx.budget.spentMicro()).toBe(1000);
  });

  it("blocks the website Compare tool when the cap is hit", async () => {
    await t.redis.set(DAY_KEY, String(CAP_MICRO));
    const res = await t.app.inject({
      method: "POST",
      url: "/internal/compare",
      payload: { prompt: "hi", a: "claude-swift", b: "llama", turnstileToken: "good" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("budget_exhausted");
  });

  it("tells the Compare tool it's busy, not paused for the day, during a burst", async () => {
    await t.redis.set(DAY_KEY, String(CAP_MICRO));
    await t.redis.set(HELD_KEY, String(CAP_MICRO));
    const res = await t.app.inject({
      method: "POST",
      url: "/internal/compare",
      payload: { prompt: "hi", a: "claude-swift", b: "llama", turnstileToken: "good" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("budget_busy");
    expect(Number(res.headers["retry-after"])).toBe(10);
    expect(await t.redis.get(HELD_KEY)).toBe(String(CAP_MICRO)); // lane A's hold was released
  });
});
