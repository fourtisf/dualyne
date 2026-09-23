import type { FastifyInstance } from "fastify";
import { treasuryConfig } from "../routes/treasury";
import { syncTreasury } from "../treasury";
import { verifyModels } from "./verifyModels";

const TICK_MS = 5 * 60 * 1000; // look every 5 minutes for jobs that are due
const FIRST_RUN_DELAY_MS = 30 * 1000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export interface Job {
  name: string;
  everyMs: number;
  run(): Promise<unknown>;
}

/** Jobs every API instance knows about. A Redis lock makes sure only one instance runs each. */
export function defaultJobs(app: FastifyInstance): Job[] {
  const { ctx } = app;
  return [
    {
      name: "verify-models",
      everyMs: DAY,
      run: async () => {
        const r = await verifyModels(ctx.prisma, ctx.openrouter, ctx.alert);
        app.log.info({ job: "verify-models", ...r }, "model check finished");
      },
    },
    {
      name: "treasury-sync",
      everyMs: HOUR,
      run: async () => {
        const cfg = treasuryConfig(ctx);
        if (!cfg) return;
        const r = await syncTreasury(ctx.prisma, cfg, ctx.clock);
        await ctx.redis.del("cache:treasury");
        app.log.info({ job: "treasury-sync", ...r, scannedTo: String(r.scannedTo) }, "treasury synced");
      },
    },
    {
      name: "purge-sessions",
      everyMs: DAY,
      run: async () => {
        const n = await ctx.sessions.purgeExpired();
        app.log.info({ job: "purge-sessions", removed: n }, "expired sessions removed");
      },
    },
  ];
}

/**
 * Tiny in-process scheduler. The last-run time lives in Redis, so each job runs once per
 * interval even across restarts and with several API instances.
 */
export async function runDueJobs(app: FastifyInstance, jobs: Job[]): Promise<void> {
  const { ctx } = app;
  const runIfDue = async (job: Job) => {
    const lastKey = `job:${job.name}:last`;
    const lockKey = `lock:job:${job.name}`;
    try {
      const last = Number((await ctx.redis.get(lastKey)) ?? 0);
      if (Date.now() - last < job.everyMs) return;
      const locked = await ctx.redis.set(lockKey, "1", "EX", 900, "NX");
      if (!locked) return;
      try {
        await job.run();
        await ctx.redis.set(lastKey, String(Date.now()));
      } finally {
        await ctx.redis.del(lockKey);
      }
    } catch (err) {
      app.log.error({ err, job: job.name }, "scheduled job failed");
    }
  };

  await Promise.all(jobs.map(runIfDue));
}

export function startScheduler(app: FastifyInstance, jobs: Job[] = defaultJobs(app)): () => void {
  const tick = () => void runDueJobs(app, jobs);

  const first = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const every = setInterval(tick, TICK_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
