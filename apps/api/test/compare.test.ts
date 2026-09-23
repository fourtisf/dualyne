import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, parseSse, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ COMPARE_LIMIT_PER_HOUR: "3" });
  await t.reset();
  t.upstream.mode = "stream";
  t.now.value = new Date("2026-09-23T12:00:00Z");
});
afterAll(async () => t?.close());

const compare = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "POST", url: "/internal/compare", payload, headers });
const good = { prompt: "Explain an AMM", a: "claude-swift", b: "llama", turnstileToken: "good" };

describe("POST /internal/compare", () => {
  it("streams both lanes over one SSE response", async () => {
    const res = await compare(good);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["x-compare-remaining"]).toBe("2");
    const events = parseSse(res.body);
    expect(events[0]!.event).toBe("meta");
    const meta = JSON.parse(events[0]!.data);
    expect(meta).toMatchObject({ a: "claude-swift", b: "llama" });

    for (const lane of ["a", "b"]) {
      const text = events
        .filter((e) => e.event === "delta" && JSON.parse(e.data).lane === lane)
        .map((e) => JSON.parse(e.data).text)
        .join("");
      expect(text).toBe("Hello ✓");
      const done = events.find((e) => e.event === "done" && JSON.parse(e.data).lane === lane);
      expect(JSON.parse(done!.data)).toMatchObject({ outputTokens: 3, costUsd: 0.00123 });
    }
    expect(events.at(-1)!.event).toBe("end");

    const run = await t.prisma.compareRun.findUniqueOrThrow({ where: { id: meta.compareId } });
    expect(run).toMatchObject({ completedA: true, completedB: true });
  });

  it("sends the fixed max_tokens and the mapped model ids upstream", async () => {
    await compare(good);
    const models = t.upstream.requests.map((r) => r.body.model).sort();
    expect(models).toEqual(["anthropic/claude-haiku-4.5", "meta-llama/llama-3.3-70b-instruct"]);
    expect(t.upstream.requests.every((r) => r.body.max_tokens === 1000)).toBe(true);
  });

  it("logs a usage row per lane with a hashed IP, never the raw IP", async () => {
    await compare(good);
    const logs = await t.prisma.usageLog.findMany();
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.source).toBe("compare");
      expect(log.ipHash).toMatch(/^[0-9a-f]{32}$/);
      expect(log.ipHash).not.toContain("127.0.0.1");
      expect(log.compareId).not.toBeNull();
    }
  });

  it("rejects a missing or bad Turnstile token", async () => {
    expect((await compare({ ...good, turnstileToken: undefined })).statusCode).toBe(403);
    const res = await compare({ ...good, turnstileToken: "bad" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("turnstile_failed");
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("only allows explorer-tier models", async () => {
    const res = await compare({ ...good, b: "gpt" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("model_not_allowed");
  });

  it("limits each IP per hour (sliding window)", async () => {
    for (let i = 0; i < 3; i++) expect((await compare(good)).statusCode).toBe(200);
    const res = await compare(good);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("rate_limited");
    expect(res.headers["x-compare-remaining"]).toBe("0");
    expect(Number(res.headers["retry-after"])).toBe(3600);

    t.now.value = new Date("2026-09-23T13:00:01Z");
    expect((await compare(good)).statusCode).toBe(200);
  });

  it("validates the body with zod", async () => {
    expect((await compare({ ...good, prompt: "" })).statusCode).toBe(400);
    expect((await compare({ ...good, prompt: "x".repeat(8001) })).statusCode).toBe(400);
    expect((await compare({ ...good, extra: 1 })).statusCode).toBe(400);
    expect((await compare({ ...good, a: "../etc" })).statusCode).toBe(400);
  });

  it("reports a failing lane without breaking the other", async () => {
    t.upstream.mode = "midstream-error";
    const events = parseSse((await compare(good)).body);
    expect(events.filter((e) => e.event === "error")).toHaveLength(2);
    expect(events.at(-1)!.event).toBe("end");
  });

  it("only lets the website's origin call it from a browser", async () => {
    const ok = await compare(good, { origin: "http://localhost:3000" });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const evil = await compare(good, { origin: "https://evil.example" });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
