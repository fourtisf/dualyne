import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/env";
import { OpenRouter } from "../src/openrouter/client";
import { chat, createKey, createTestContext, hello, type TestContext } from "./helpers";

// Preview mode: the site is deployed before the OpenRouter key exists.

const prodEnv = (extra: Record<string, string>) => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379/0",
  IP_HASH_SECRET: "x".repeat(32),
  SESSION_SECRET: "y".repeat(32),
  ...extra,
});

describe("production settings", () => {
  it("start without an OpenRouter key (preview)", () => {
    expect(() => loadEnv(prodEnv({}))).not.toThrow();
  });

  it("start with an OpenRouter key and no Turnstile (bot check is optional)", () => {
    expect(() => loadEnv(prodEnv({ OPENROUTER_API_KEY: "sk-or-v1-abcdef123456" }))).not.toThrow();
    expect(() => loadEnv(prodEnv({ OPENROUTER_API_KEY: "short" }))).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("without an OpenRouter key", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext({ OPENROUTER_API_KEY: "" });
  });
  afterAll(async () => t?.close());

  it("comparisons answer 503 models_not_live and call no model", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/internal/compare",
      payload: { prompt: "Hi", a: "claude-swift", b: "llama", turnstileToken: "good" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("models_not_live");
    expect(t.upstream.requests).toHaveLength(0);
    expect(await t.prisma.usageLog.count()).toBe(0);
  });

  it("the API checks the key first, then answers 503 models_not_live", async () => {
    expect((await chat(t.app, "dly_live_nope", hello("llama"))).statusCode).toBe(401);

    const { key } = await createKey(t.prisma);
    const res = await chat(t.app, key, hello("llama"));
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("models_not_live");
    expect(t.upstream.requests).toHaveLength(0);
  });
});

describe("OpenRouter client", () => {
  it("sends no authorization header without a key", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const opts = { baseUrl: "https://or.test/v1", appUrl: "https://dualyne.com", appTitle: "Dualyne" };
      await new OpenRouter({ ...opts, apiKey: "" }).models();
      await new OpenRouter({ ...opts, apiKey: "sk-or-v1-secret" }).models();
      const headers = fetchMock.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].headers);
      expect(headers[0]).not.toHaveProperty("authorization");
      expect(headers[1]).toHaveProperty("authorization", "Bearer sk-or-v1-secret");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
