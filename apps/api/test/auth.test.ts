import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/lib/hash";
import { chat, createKey, createTestContext, hello, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext();
  await t.reset();
  t.upstream.mode = "json";
});
afterAll(async () => t?.close());

describe("API key auth", () => {
  it("rejects a request without a key", async () => {
    const res = await chat(t.app, null, hello("claude-swift"));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("missing_api_key");
  });

  it("rejects a malformed key without touching the database", async () => {
    const res = await chat(t.app, "not-a-key", hello("claude-swift"));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_api_key");
  });

  it("rejects a well-formed key that does not exist", async () => {
    const res = await chat(t.app, `rf_live_${"0".repeat(32)}`, hello("claude-swift"));
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatchObject({ code: "invalid_api_key", type: "authentication_error" });
  });

  it("accepts a valid key", async () => {
    const { key } = await createKey(t.prisma, "explorer");
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(200);
  });

  it("stores only the SHA-256 hash and last 4 characters", async () => {
    const { key, keyId } = await createKey(t.prisma);
    const row = await t.prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.hash).toBe(sha256Hex(key));
    expect(row.last4).toBe(key.slice(-4));
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it("stops working on the very next request after revoke, even when cached", async () => {
    const { key, keyId } = await createKey(t.prisma);
    expect((await chat(t.app, key, hello("claude-swift"))).statusCode).toBe(200); // now cached
    expect(await t.app.ctx.auth.revoke(keyId)).toBe(true);
    const res = await chat(t.app, key, hello("claude-swift"));
    expect(res.statusCode).toBe(401);
  });

  it("never forwards the client's key upstream, only the server key", async () => {
    const { key } = await createKey(t.prisma);
    await chat(t.app, key, hello("claude-swift"));
    const sent = t.upstream.requests.at(-1)!;
    expect(sent.headers.authorization).toBe("Bearer sk-or-test-secret");
    expect(JSON.stringify(sent.body)).not.toContain(key);
  });
});
