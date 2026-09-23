import type { ServiceState, StatusResponse } from "@dualyne/shared";
import type { FastifyPluginAsync } from "fastify";
import { secondsUntilUtcMidnight } from "../lib/time";

const WINDOW_MS = 3_600_000;
const CACHE_MS = 15_000;
/** Below this many calls in the window, a model's error rate is not judged. */
const MIN_SAMPLE = 5;

interface ModelStats {
  modelId: string;
  requests: number;
  errors: number;
  ttft: number | null;
}

/** A model's state from its last hour of upstream calls. */
export function modelState(requests: number, errors: number): ServiceState {
  if (requests < MIN_SAMPLE) return "operational";
  const rate = errors / requests;
  return rate >= 0.5 ? "down" : rate >= 0.1 ? "degraded" : "operational";
}

/** Public status page data. Cached for a few seconds per instance. */
export const statusRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  let cached: { at: number; body: StatusResponse } | null = null;

  app.get("/status", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=15");
    const now = ctx.clock();
    if (cached && now.getTime() - cached.at < CACHE_MS) return cached.body;

    const [database, cache] = await Promise.all([
      ctx.prisma.$queryRaw`SELECT 1`.then(
        () => "ok" as const,
        () => "down" as const,
      ),
      ctx.redis.ping().then(
        (r) => (r === "PONG" ? ("ok" as const) : ("down" as const)),
        () => "down" as const,
      ),
    ]);

    let models: StatusResponse["models"] = [];
    let freeCompare: StatusResponse["freeCompare"] = { state: "available", resumesAt: null };
    let jobs: StatusResponse["jobs"] = { modelsVerifiedAt: null, treasurySyncedAt: null };

    if (database === "ok") {
      const since = new Date(now.getTime() - WINDOW_MS);
      const [rows, stats] = await Promise.all([
        ctx.prisma.model.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } }),
        ctx.prisma.$queryRaw<ModelStats[]>`
          SELECT "modelId",
                 count(*)::int AS requests,
                 count(*) FILTER (WHERE status >= 500)::int AS errors,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY "ttftMs")
                   FILTER (WHERE "ttftMs" IS NOT NULL) AS ttft
          FROM "UsageLog"
          WHERE "createdAt" > ${since} AND status <> 499
          GROUP BY "modelId"`,
      ]);
      const byId = new Map(stats.map((s) => [s.modelId, s]));
      models = rows.map((m) => {
        const s = byId.get(m.id);
        const requests = s?.requests ?? 0;
        const errors = s?.errors ?? 0;
        return {
          id: m.id,
          name: m.name,
          state: m.missingSince ? "unavailable" : modelState(requests, errors),
          requests,
          errorRate: requests ? Math.round((errors / requests) * 1000) / 1000 : null,
          ttftMs: s?.ttft == null ? null : Math.round(Number(s.ttft)),
        };
      });
    }
    if (cache === "ok") {
      if (database === "ok" && (await ctx.budget.isExhausted())) {
        const resumes = new Date(now.getTime() + secondsUntilUtcMidnight(now) * 1000);
        freeCompare = { state: "paused", resumesAt: resumes.toISOString() };
      }
      const [verified, synced] = await ctx.redis.mget("job:verify-models:last", "job:treasury-sync:last");
      const iso = (v: string | null | undefined) => (v ? new Date(Number(v)).toISOString() : null);
      jobs = { modelsVerifiedAt: iso(verified), treasurySyncedAt: iso(synced) };
    }

    const status: ServiceState =
      database === "down" || cache === "down"
        ? "down"
        : models.some((m) => m.state === "down" || m.state === "degraded")
          ? "degraded"
          : "operational";
    const body: StatusResponse = {
      status,
      checkedAt: now.toISOString(),
      services: { api: "ok", database, cache },
      freeCompare,
      models,
      jobs,
    };
    cached = { at: now.getTime(), body };
    return body;
  });
};
