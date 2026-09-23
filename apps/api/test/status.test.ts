import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { modelState } from "../src/routes/status";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ DAILY_BUDGET_USD: "0.01" });
  await t.reset();
  t.now.value = new Date(t.now.value.getTime() + 60_000); // step past the per-instance cache
});
afterAll(async () => t?.close());

const minutesAgo = (m: number) => new Date(t.now.value.getTime() - m * 60_000);

async function logCalls(
  modelId: string,
  n: number,
  opts: { status?: number; ttftMs?: number; at?: Date } = {},
) {
  await t.prisma.usageLog.createMany({
    data: Array.from({ length: n }, () => ({
      source: "compare",
      modelId,
      openrouterId: "x/y",
      latencyMs: 900,
      ttftMs: opts.ttftMs ?? 300,
      status: opts.status ?? 200,
      stream: true,
      createdAt: opts.at ?? minutesAgo(5),
    })),
  });
}

const status = async () => (await t.app.inject({ method: "GET", url: "/status" })).json();

describe("GET /status", () => {
  it("is operational with no traffic and lists every enabled model", async () => {
    const body = await status();
    expect(body).toMatchObject({
      status: "operational",
      services: { api: "ok", database: "ok", cache: "ok" },
      freeCompare: { state: "available", resumesAt: null },
    });
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]).toMatchObject({
      state: "operational",
      requests: 0,
      errorRate: null,
      ttftMs: null,
    });
  });

  it("judges each model from its last hour of upstream calls", async () => {
    await logCalls("claude-swift", 18, { ttftMs: 400 });
    await logCalls("claude-swift", 2, { status: 502 }); // 10% errors
    await logCalls("llama", 3, { status: 502 });
    await logCalls("llama", 2); // 60% errors
    await logCalls("deepseek", 40, { status: 502, at: minutesAgo(90) }); // outside the window
    await logCalls("mistral", 3, { status: 499 }); // cancelled by the visitor: ignored

    const body = await status();
    const m = (id: string) => body.models.find((x: { id: string }) => x.id === id);
    expect(m("claude-swift")).toMatchObject({ state: "degraded", requests: 20, errorRate: 0.1, ttftMs: 400 });
    expect(m("llama")).toMatchObject({ state: "down", requests: 5, errorRate: 0.6 });
    expect(m("deepseek")).toMatchObject({ state: "operational", requests: 0 });
    expect(m("mistral")).toMatchObject({ requests: 0 });
    expect(body.status).toBe("degraded");
  });

  it("marks models missing upstream as unavailable", async () => {
    await t.prisma.model.update({ where: { id: "gemini" }, data: { missingSince: minutesAgo(60) } });
    const body = await status();
    expect(body.models.find((x: { id: string }) => x.id === "gemini").state).toBe("unavailable");
  });

  it("says when free comparisons are paused and when they resume", async () => {
    await t.redis.set(t.app.ctx.budget.key(), "10000");
    const body = await status();
    expect(body.freeCompare.state).toBe("paused");
    expect(new Date(body.freeCompare.resumesAt).toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("reports the last job runs", async () => {
    await t.redis.set("job:verify-models:last", String(Date.parse("2026-09-23T03:00:00Z")));
    expect((await status()).jobs.modelsVerifiedAt).toBe("2026-09-23T03:00:00.000Z");
  });
});

describe("modelState", () => {
  it("needs a minimum sample before judging", () => {
    expect(modelState(4, 4)).toBe("operational");
    expect(modelState(10, 0)).toBe("operational");
    expect(modelState(10, 1)).toBe("degraded");
    expect(modelState(10, 5)).toBe("down");
  });
});
