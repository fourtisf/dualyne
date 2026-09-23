import type { FastifyInstance } from "fastify";
import { verifyModels } from "./verifyModels";

const CHECK_EVERY_MS = 60 * 60 * 1000; // look every hour whether a daily job is due
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;

/**
 * Tiny in-process scheduler. A Redis lock makes sure only one API instance runs a job,
 * and the last-run timestamp in Redis makes it run once per day even across restarts.
 */
export function startScheduler(app: FastifyInstance): () => void {
  const { ctx } = app;

  const runIfDue = async (name: string, fn: () => Promise<unknown>) => {
    const lastKey = `job:${name}:last`;
    const lockKey = `lock:job:${name}`;
    try {
      const last = Number((await ctx.redis.get(lastKey)) ?? 0);
      if (Date.now() - last < DAY_MS) return;
      const locked = await ctx.redis.set(lockKey, "1", "EX", 900, "NX");
      if (!locked) return;
      try {
        await fn();
        await ctx.redis.set(lastKey, String(Date.now()));
      } finally {
        await ctx.redis.del(lockKey);
      }
    } catch (err) {
      app.log.error({ err, job: name }, "scheduled job failed");
    }
  };

  const tick = () =>
    void runIfDue("verify-models", async () => {
      const r = await verifyModels(ctx.prisma, ctx.openrouter, ctx.alert);
      app.log.info({ job: "verify-models", ...r }, "model check finished");
    });

  const first = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const every = setInterval(tick, CHECK_EVERY_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
