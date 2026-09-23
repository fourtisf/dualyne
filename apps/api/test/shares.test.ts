import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, parseSse, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ COMPARE_LIMIT_PER_HOUR: "50" });
  await t.reset();
  t.upstream.mode = "stream";
});
afterAll(async () => t?.close());

async function compare(payload: Record<string, unknown> = { a: "claude-swift", b: "llama" }) {
  const res = await t.app.inject({
    method: "POST",
    url: "/internal/compare",
    payload: { prompt: "Explain an AMM", turnstileToken: "good", ...payload },
  });
  return JSON.parse(parseSse(res.body)[0]!.data).compareId as string;
}
const share = (compareId: string, remoteAddress = "127.0.0.1") =>
  t.app.inject({ method: "POST", url: "/shares", payload: { compareId }, remoteAddress });

describe("sharing a comparison", () => {
  it("publishes prompt, models and answers only when asked, and can be removed with the token", async () => {
    const compareId = await compare();
    expect(await t.prisma.share.count()).toBe(0); // nothing stored until Share is clicked
    const res = await share(compareId);
    expect(res.statusCode).toBe(201);
    const { id, token } = res.json();
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);

    const pub = await t.app.inject({ method: "GET", url: `/shares/${id}` });
    expect(pub.json()).toMatchObject({
      prompt: "Explain an AMM",
      a: "claude-swift",
      b: "llama",
      answerA: "Hello ✓",
      answerB: "Hello ✓",
    });

    expect((await share(compareId)).json()).toEqual({ id, token: null }); // same link again

    const bad = await t.app.inject({
      method: "DELETE",
      url: `/shares/${id}`,
      payload: { token: "x".repeat(20) },
    });
    expect(bad.statusCode).toBe(404);
    const del = await t.app.inject({ method: "DELETE", url: `/shares/${id}`, payload: { token } });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/shares/${id}` })).statusCode).toBe(404);
  });

  it("only lets the person who ran it share, within an hour", async () => {
    const compareId = await compare();
    expect((await share(compareId, "10.1.1.1")).statusCode).toBe(404);
    await t.redis.del(`cmpout:${compareId}`); // an hour later
    expect((await share(compareId)).json().error.code).toBe("expired");
  });

  it("requires a vote before sharing a blind run, and nothing is kept for failed runs", async () => {
    const blindId = await compare({ blind: true });
    expect((await share(blindId)).json().error.code).toBe("vote_first");
    await t.app.inject({ method: "POST", url: "/votes", payload: { compareId: blindId, winner: "a" } });
    expect((await share(blindId)).statusCode).toBe(201);

    t.upstream.mode = "midstream-error";
    const failed = await compare();
    expect(await t.redis.get(`cmpout:${failed}`)).toBeNull();
  });
});
