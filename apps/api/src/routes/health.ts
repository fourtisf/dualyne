import type { FastifyPluginAsync } from "fastify";

/** Liveness + dependency check used by Docker healthchecks and the deploy script. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  app.get("/health", async (_req, reply) => {
    const [db, redis] = await Promise.all([
      ctx.prisma.$queryRaw`SELECT 1`.then(
        () => "ok",
        () => "down",
      ),
      ctx.redis.ping().then(
        (r) => (r === "PONG" ? "ok" : "down"),
        () => "down",
      ),
    ]);
    const missing =
      db === "ok"
        ? (
            await ctx.prisma.model.findMany({ where: { missingSince: { not: null } }, select: { id: true } })
          ).map((m) => m.id)
        : [];
    const ok = db === "ok" && redis === "ok";
    reply.header("cache-control", "no-store");
    return reply
      .status(ok ? 200 : 503)
      .send({ status: ok ? "ok" : "degraded", db, redis, modelsMissing: missing });
  });
};
