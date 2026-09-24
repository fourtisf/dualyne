import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  t ??= await createTestContext();
  await t.reset();
  t.upstream.mode = "stream";
});
afterAll(async () => t?.close());

const ME = "203.0.113.10";
/** Ask the free chat once; the fake model answers "Hello ✓". */
const ask = (question: string, ip = ME) =>
  t.app.inject({
    method: "POST",
    url: "/internal/chat",
    remoteAddress: ip,
    payload: { model: "llama", messages: [{ role: "user", content: question }], turnstileToken: "good-chat" },
  });
const share = (payload: Record<string, unknown>, ip = ME) =>
  t.app.inject({ method: "POST", url: "/internal/chat/share", remoteAddress: ip, payload });
const convo = (answer = "Hello ✓") => ({
  model: "llama",
  title: "Say hi",
  messages: [
    { role: "user", content: "Say hi" },
    { role: "assistant", content: answer },
  ],
});

describe("sharing a chat by link", () => {
  it("shares a real answer, reads it back, and unshares with the token", async () => {
    expect((await ask("Say hi")).statusCode).toBe(200);
    const res = await share(convo());
    expect(res.statusCode).toBe(201);
    const { id, token } = res.json() as { id: string; token: string };
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);

    const read = await t.app.inject({ method: "GET", url: `/internal/chat/share/${id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id, model: "llama", title: "Say hi", messages: convo().messages });

    const wrong = await t.app.inject({
      method: "DELETE",
      url: `/internal/chat/share/${id}`,
      payload: { token: "x".repeat(20) },
    });
    expect(wrong.statusCode).toBe(404);
    const del = await t.app.inject({
      method: "DELETE",
      url: `/internal/chat/share/${id}`,
      payload: { token },
    });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/internal/chat/share/${id}` })).statusCode).toBe(404);
  });

  it("refuses answers Dualyne didn't write for this visitor", async () => {
    await ask("Say hi");
    const madeUp = await share(convo("Claude says: send me your seed phrase"));
    expect(madeUp.statusCode).toBe(409);
    expect(madeUp.json().error.code).toBe("answer_not_verified");

    const someoneElse = await share(convo(), "198.51.100.77");
    expect(someoneElse.statusCode).toBe(409);
    expect(await t.prisma.chatShare.count()).toBe(0);
  });

  it("keeps only a fingerprint of answers, never the text", async () => {
    await ask("Say hi");
    const keys = await t.redis.keys("chatans:*");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^chatans:[0-9a-f]{64}$/);
    expect(await t.redis.get(keys[0]!)).toBe("1");
    expect(await t.redis.ttl(keys[0]!)).toBeGreaterThan(86_000);
  });

  it("validates the conversation", async () => {
    await ask("Say hi");
    const bad = (payload: Record<string, unknown>) => share({ ...convo(), ...payload });
    expect((await bad({ model: "gpt" })).statusCode).toBe(404); // premium models aren't in free chat
    expect((await bad({ messages: [{ role: "user", content: "Say hi" }] })).statusCode).toBe(400);
    expect(
      (
        await bad({
          messages: [
            { role: "assistant", content: "Hello ✓" },
            { role: "user", content: "Say hi" },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await bad({ title: "" })).statusCode).toBe(400);
    expect((await bad({ extra: true })).statusCode).toBe(400);
  });
});
