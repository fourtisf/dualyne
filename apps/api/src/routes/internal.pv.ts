import type { FastifyPluginAsync } from "fastify";
import { cleanPath, isBot, pageViewSchema, recordVisit, refDomain, utcDay } from "../analytics/visits";

/**
 * POST /internal/pv: the website reports one page view. No cookies, no stored IP: the visitor is
 * a keyed hash of IP + browser + day (see analytics/visits.ts). Bots and "do not track" are skipped
 * on the website side and bots again here.
 */
export const pageViewRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  app.post(
    "/internal/pv",
    { config: { rateLimit: { max: 60, timeWindow: 60_000 } }, bodyLimit: 4096 },
    async (req, reply) => {
      const body = pageViewSchema.parse(req.body);
      const ua = req.headers["user-agent"];
      if (!isBot(ua)) {
        const day = utcDay(ctx.clock());
        await recordVisit(ctx.redis, {
          day,
          visitor: ctx.ipHash(`${day}|${req.ip}|${ua}`),
          path: cleanPath(body.path),
          ref: refDomain(body.ref, ctx.env.SITE_DOMAIN),
        });
      }
      return reply.status(204).send();
    },
  );
};
