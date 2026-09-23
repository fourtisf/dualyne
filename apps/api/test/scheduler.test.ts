import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { defaultJobs, runDueJobs, type Job } from "../src/jobs/scheduler";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeEach(async () => {
  if (!t) t = await createTestContext();
  await t.reset();
});
afterAll(async () => t?.close());

describe("scheduler", () => {
  it("runs a due job once per interval, and never twice at the same time", async () => {
    let runs = 0;
    const job: Job = {
      name: "test-job",
      everyMs: 60_000,
      run: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 50));
      },
    };
    await Promise.all([runDueJobs(t.app, [job]), runDueJobs(t.app, [job])]);
    expect(runs).toBe(1);
    await runDueJobs(t.app, [job]);
    expect(runs).toBe(1); // not due yet
  });

  it("keeps going when a job fails and retries it next time", async () => {
    let calls = 0;
    const flaky: Job = {
      name: "flaky",
      everyMs: 60_000,
      run: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
      },
    };
    await runDueJobs(t.app, [flaky]);
    await runDueJobs(t.app, [flaky]);
    expect(calls).toBe(2);
  });

  it("purges expired sessions", async () => {
    const wallet = await t.prisma.wallet.create({ data: { address: `0x${"e".repeat(40)}` } });
    await t.prisma.session.create({
      data: { id: "old", walletId: wallet.id, expiresAt: new Date("2020-01-01") },
    });
    await t.prisma.session.create({
      data: { id: "new", walletId: wallet.id, expiresAt: new Date("2030-01-01") },
    });
    const purge = defaultJobs(t.app).find((j) => j.name === "purge-sessions")!;
    await purge.run();
    expect((await t.prisma.session.findMany()).map((s) => s.id)).toEqual(["new"]);
  });
});
