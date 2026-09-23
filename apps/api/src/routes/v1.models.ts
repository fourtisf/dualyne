import { tierAllows } from "@refract/shared";
import type { FastifyPluginAsync } from "fastify";

interface RouteOpts {
  routeConfig: Record<string, unknown>;
}

/** OpenAI-compatible model list, filtered to what the caller's tier may use. */
export const modelsRoutes: FastifyPluginAsync<RouteOpts> = async (app, opts) => {
  const { ctx } = app;
  app.get("/v1/models", { config: opts.routeConfig }, async (req) => {
    const principal = await ctx.auth.authenticate(req.headers.authorization);
    const models = await ctx.prisma.model.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    });
    return {
      object: "list",
      data: models
        .filter((m) => tierAllows(principal.tier, m.minTier))
        .map((m) => ({
          id: m.id,
          object: "model",
          created: Math.floor(m.createdAt.getTime() / 1000),
          owned_by: m.provider.toLowerCase(),
          name: m.name,
          upstream: m.upstreamName,
          context_length: m.contextLength,
          min_tier: m.minTier,
        })),
    };
  });
};
