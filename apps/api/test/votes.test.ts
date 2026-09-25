import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recomputeElo } from "../src/elo";
import { createTestContext, parseSse, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext({ COMPARE_LIMIT_PER_HOUR: "50" });
  await t.reset();
  t.upstream.mode = "stream";
  t.now.value = new Date("2026-09-23T12:00:00Z");
});
afterAll(async () => t?.close());

async function runCompare(payload: Record<string, unknown>) {
  const res = await t.app.inject({
    method: "POST",
    url: "/internal/compare",
    payload: { prompt: "hi", turnstileToken: "good", ...payload },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(parseSse(res.body)[0]!.data) as {
    compareId: string;
    a: string | null;
    b: string | null;
    blind: boolean;
  };
}
const vote = (compareId: string, winner: string, remoteAddress = "127.0.0.1") =>
  t.app.inject({ method: "POST", url: "/votes", payload: { compareId, winner }, remoteAddress });

describe("community votes", () => {
  it("accepts one vote per completed comparison and lets the voter change it", async () => {
    const { compareId } = await runCompare({ a: "claude-swift", b: "llama" });
    const res = await vote(compareId, "a");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, counted: true, a: "claude-swift", b: "llama" });
    expect((await vote(compareId, "tie")).statusCode).toBe(200);
    const rows = await t.prisma.vote.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.winner).toBe("tie");
  });

  it("only the browser/IP that ran the comparison can vote on it", async () => {
    const { compareId } = await runCompare({ a: "claude-swift", b: "llama" });
    const res = await vote(compareId, "a", "10.9.9.9");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("not_your_compare");
  });

  it("rejects votes without a matching completed comparison", async () => {
    expect((await vote("nope", "a")).statusCode).toBe(404);
    t.upstream.mode = "midstream-error";
    const { compareId } = await runCompare({ a: "claude-swift", b: "llama" });
    const res = await vote(compareId, "a");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("compare_incomplete");
  });

  it("closes voting after the vote window", async () => {
    const { compareId } = await runCompare({ a: "claude-swift", b: "llama" });
    t.now.value = new Date(t.now.value.getTime() + 25 * 3_600_000);
    expect((await vote(compareId, "a")).statusCode).toBe(410);
  });

  it("stores same-model votes but leaves them out of the ratings", async () => {
    const { compareId } = await runCompare({ a: "llama", b: "llama" });
    expect((await vote(compareId, "a")).json().counted).toBe(false);
    await recomputeElo(t.prisma, { blindOnly: false });
    expect(await t.prisma.eloRating.count()).toBe(0);
  });

  it("computes Elo with K=24 from 1000 and serves the leaderboard", async () => {
    const { compareId } = await runCompare({ a: "claude-swift", b: "llama" });
    await vote(compareId, "a");
    const lb = (await t.app.inject({ method: "GET", url: "/leaderboard" })).json();
    expect(lb.totalVotes).toBe(1);
    expect(lb.rows).toEqual([
      { modelId: "claude-swift", rating: 1012, wins: 1, losses: 0, ties: 0, games: 1 },
      { modelId: "llama", rating: 988, wins: 0, losses: 1, ties: 0, games: 1 },
    ]);
  });
});

describe("leaderboard categories", () => {
  it("files each vote under a category guessed from the prompt and ranks per category", async () => {
    const code = await runCompare({ a: "claude-swift", b: "llama", prompt: "Fix this Python bug: x = [1,2" });
    const chat = await runCompare({ a: "claude-swift", b: "llama", prompt: "Tell me a fun fact" });
    await vote(code.compareId, "b");
    await vote(chat.compareId, "a");
    const votes = await t.prisma.vote.findMany({ orderBy: { createdAt: "asc" } });
    expect(votes.map((v) => v.category).sort()).toEqual(["coding", "general"]);
    await recomputeElo(t.prisma, { blindOnly: false });

    const coding = (await t.app.inject({ method: "GET", url: "/leaderboard?category=coding" })).json();
    expect(coding.category).toBe("coding");
    expect(coding.totalVotes).toBe(1);
    expect(coding.rows[0]).toMatchObject({ modelId: "llama", wins: 1, games: 1 });
    const all = (await t.app.inject({ method: "GET", url: "/leaderboard" })).json();
    expect(all).toMatchObject({ category: "all", totalVotes: 2 });
    expect(all.rows.map((r: { games: number }) => r.games)).toEqual([2, 2]);
    const writing = (await t.app.inject({ method: "GET", url: "/leaderboard?category=writing" })).json();
    expect(writing).toMatchObject({ totalVotes: 0, rows: [] });
    expect((await t.app.inject({ method: "GET", url: "/leaderboard?category=poems" })).statusCode).toBe(400);
  });
});

describe("blind comparisons", () => {
  it("picks two different free models, hides them, and reveals them after the vote", async () => {
    const meta = await runCompare({ blind: true });
    expect(meta).toMatchObject({ a: null, b: null, blind: true });
    const run = await t.prisma.compareRun.findUniqueOrThrow({ where: { id: meta.compareId } });
    expect(run.blind).toBe(true);
    expect(run.modelA).not.toBe(run.modelB);
    const free = ["claude-swift", "llama", "deepseek", "mistral"];
    expect(free).toContain(run.modelA);
    expect(free).toContain(run.modelB);
    const res = (await vote(meta.compareId, "b")).json();
    expect(res).toMatchObject({ a: run.modelA, b: run.modelB, counted: true });
  });

  it("in 'always' mode, forces every run blind and ranks only blind votes", async () => {
    const strict = await createTestContext({ COMPARE_BLIND_MODE: "always", COMPARE_LIMIT_PER_HOUR: "50" });
    strict.upstream.mode = "stream";
    const res = await strict.app.inject({
      method: "POST",
      url: "/internal/compare",
      payload: { prompt: "hi", a: "claude-swift", b: "llama", turnstileToken: "good" },
    });
    const meta = JSON.parse(parseSse(res.body)[0]!.data);
    expect(meta.blind).toBe(true);
    expect(meta.a).toBeNull();

    // An older non-blind vote must not count in this mode.
    const old = await strict.prisma.compareRun.create({
      data: { modelA: "claude-swift", modelB: "llama", ipHash: "x", completedA: true, completedB: true },
    });
    await strict.prisma.vote.create({
      data: {
        compareId: old.id,
        modelA: "claude-swift",
        modelB: "llama",
        winner: "a",
        blind: false,
        ipHash: "x",
      },
    });
    await strict.app.inject({
      method: "POST",
      url: "/votes",
      payload: { compareId: meta.compareId, winner: "tie" },
    });
    const lb = (await strict.app.inject({ method: "GET", url: "/leaderboard" })).json();
    expect(lb.blindOnly).toBe(true);
    expect(lb.totalVotes).toBe(1);
    expect(lb.rows.every((r: { rating: number }) => r.rating === 1000)).toBe(true);
    await strict.close();
  });

  it("tells the website which mode is active", async () => {
    const res = (await t.app.inject({ method: "GET", url: "/internal/catalog" })).json();
    expect(res.settings).toEqual({ blindMode: "optional" });
  });
});
