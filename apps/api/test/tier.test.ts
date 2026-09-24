import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chat, createKey, createTestContext, hello, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext();
  await t.reset();
  t.upstream.mode = "json";
});
afterAll(async () => t?.close());

describe("tier check", () => {
  it("blocks an explorer key from a holder model with 403", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("gpt"));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: "model_not_in_tier", type: "permission_error" });
    // With the token hidden, the message doesn't mention the Holder tier.
    expect(res.json().error.message).toMatch(/not in the free tier/);
    expect(t.upstream.requests).toHaveLength(0);
  });

  it("lets a holder key use a holder model", async () => {
    const { key } = await createKey(t.prisma, "holder");
    expect((await chat(t.app, key, hello("gpt"))).statusCode).toBe(200);
  });

  it("lets a builder key use every model", async () => {
    const { key } = await createKey(t.prisma, "builder");
    expect((await chat(t.app, key, hello("claude-deep"))).statusCode).toBe(200);
  });

  it("returns 404 for an unknown model id", async () => {
    const { key } = await createKey(t.prisma, "builder");
    const res = await chat(t.app, key, hello("no-such-model"));
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("model_not_found");
  });

  it("filters GET /v1/models to the caller's tier", async () => {
    const explorer = await createKey(t.prisma, "explorer");
    const holder = await createKey(t.prisma, "holder", `0x${"b".repeat(40)}`);
    const list = async (key: string) =>
      (
        await t.app.inject({ method: "GET", url: "/v1/models", headers: { authorization: `Bearer ${key}` } })
      ).json() as { object: string; data: { id: string; object: string }[] };

    const e = await list(explorer.key);
    expect(e.object).toBe("list");
    expect(e.data.map((m) => m.id).sort()).toEqual(["claude-swift", "deepseek", "llama", "mistral"]);
    expect(e.data.every((m) => m.object === "model")).toBe(true);

    const h = await list(holder.key);
    expect(h.data).toHaveLength(8);
  });

  it("requires a key for GET /v1/models", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(401);
  });
});
