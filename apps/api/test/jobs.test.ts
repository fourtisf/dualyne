import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { verifyModels } from "../src/jobs/verifyModels";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
const alerts: string[] = [];
beforeEach(async () => {
  if (!t) t = await createTestContext();
  await t.reset();
  alerts.length = 0;
});
afterAll(async () => t?.close());

const entry = (id: string, created = 1_700_000_000) => ({
  id,
  name: `Vendor: ${id.split("/")[1]}`,
  created,
  context_length: 123_456,
  pricing: { prompt: "0.000002", completion: "0.000008" },
});

describe("daily model verification", () => {
  it("refreshes prices and flags models whose OpenRouter id disappeared", async () => {
    const models = await t.prisma.model.findMany();
    t.upstream.catalog = models
      .filter((m) => m.id !== "gemini")
      .map((m) => entry(m.openrouterId))
      .concat([entry("anthropic/claude-haiku-9", 1_900_000_000)]);

    const r = await verifyModels(t.prisma, t.app.ctx.openrouter, async (a) => void alerts.push(a));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["gemini"]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("gemini → google/gemini-2.5-pro");
    expect(r.newer).toContainEqual({
      id: "claude-swift",
      current: "anthropic/claude-haiku-4.5",
      newest: "anthropic/claude-haiku-9",
    });

    const swift = await t.prisma.model.findUniqueOrThrow({ where: { id: "claude-swift" } });
    expect(swift.promptPrice.toString()).toBe("0.000002");
    expect(swift.contextLength).toBe(123_456);
    expect(swift.upstreamName).toBe("claude-haiku-4.5");
    const gemini = await t.prisma.model.findUniqueOrThrow({ where: { id: "gemini" } });
    expect(gemini.missingSince).not.toBeNull();

    const catalog = (await t.app.inject({ method: "GET", url: "/internal/catalog" })).json();
    const g = catalog.data.find((m: { id: string }) => m.id === "gemini");
    expect(g.live).toBe(false);
    const health = (await t.app.inject({ method: "GET", url: "/health" })).json();
    expect(health).toMatchObject({ status: "ok", db: "ok", redis: "ok", modelsMissing: ["gemini"] });
    expect(await t.prisma.modelCheck.count()).toBe(1);
  });
});

describe("public catalog", () => {
  it("lists every enabled model with prices per 1M tokens", async () => {
    const res = await t.app.inject({ method: "GET", url: "/internal/catalog" });
    expect(res.statusCode).toBe(200);
    const swift = res.json().data[0];
    expect(swift).toMatchObject({
      id: "claude-swift",
      name: "Claude Swift",
      minTier: "explorer",
      inputPerMTok: 1,
      outputPerMTok: 5,
      live: true,
    });
    expect(res.json().data).toHaveLength(8);
  });

  it("returns OpenAI-shaped 404s for unknown routes", async () => {
    const res = await t.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});
