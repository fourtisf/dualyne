import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chat, createKey, createTestContext, hello, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ TIER_EXPLORER_DAILY: "3" });
  await t.reset();
  t.upstream.mode = "json";
  t.now.value = new Date("2026-09-23T12:00:00Z");
});
afterAll(async () => t?.close());

describe("quota counting", () => {
  it("counts down x-refract-remaining and returns 429 after the daily limit", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const remaining: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await chat(t.app, key, hello("claude-swift"));
      expect(res.statusCode).toBe(200);
      remaining.push(String(res.headers["x-refract-remaining"]));
    }
    expect(remaining).toEqual(["2", "1", "0"]);

    const over = await chat(t.app, key, hello("claude-swift"));
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe("quota_exceeded");
    expect(over.headers["x-refract-remaining"]).toBe("0");
    expect(Number(over.headers["retry-after"])).toBe(12 * 3600);
    expect(t.upstream.requests).toHaveLength(3);
  });

  it("uses the key quota:{wallet}:{YYYY-MM-DD} with a 48h expiry", async () => {
    const { key, address } = await createKey(t.prisma, "explorer");
    await chat(t.app, key, hello("claude-swift"));
    const redisKey = `quota:${address}:2026-09-23`;
    expect(await t.redis.get(redisKey)).toBe("1");
    const ttl = await t.redis.ttl(redisKey);
    expect(ttl).toBeGreaterThan(47 * 3600);
    expect(ttl).toBeLessThanOrEqual(48 * 3600);
  });

  it("shares the quota across all keys of one wallet", async () => {
    const address = `0x${"c".repeat(40)}`;
    const k1 = await createKey(t.prisma, "explorer", address);
    const k2 = await createKey(t.prisma, "explorer", address);
    await chat(t.app, k1.key, hello("claude-swift"));
    await chat(t.app, k2.key, hello("claude-swift"));
    await chat(t.app, k1.key, hello("claude-swift"));
    expect((await chat(t.app, k2.key, hello("claude-swift"))).statusCode).toBe(429);
  });

  it("resets on the next UTC day", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    for (let i = 0; i < 3; i++) await chat(t.app, key, hello("claude-swift"));
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(429);
    t.now.value = new Date("2026-09-24T00:00:01Z");
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-refract-remaining"]).toBe("2");
  });

  it("refunds the request when the provider fails", async () => {
    const { key, address } = await createKey(t.prisma, "explorer");
    t.upstream.mode = "error";
    t.upstream.errorStatus = 503;
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(502);
    expect(await t.redis.get(`quota:${address}:2026-09-23`)).toBe("0");
  });

  it("never overshoots under concurrent requests", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => chat(t.app, key, hello("claude-swift"))),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(7);
  });

  it("does not cap the builder tier", async () => {
    const { key } = await createKey(t.prisma, "builder");
    for (let i = 0; i < 5; i++) {
      const res = await chat(t.app, key, hello("claude-swift"));
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-refract-remaining"]).toBeUndefined();
    }
  });
});
