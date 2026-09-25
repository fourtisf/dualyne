import { modelHasVision, perMTok, type CatalogModel } from "@dualyne/shared";
import type { FastifyPluginAsync } from "fastify";

/** Public catalog for the website: names, tiers, prices and context length. No key needed. */
export const catalogRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  app.get("/internal/catalog", async (_req, reply) => {
    const models = await ctx.prisma.model.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    });
    const data: CatalogModel[] = models.map((m) => ({
      id: m.id,
      name: m.name,
      menuName: m.menuName,
      provider: m.provider,
      providerColor: m.providerColor,
      bestFor: m.bestFor,
      speed: m.speed,
      minTier: m.minTier,
      vision: modelHasVision(m.id),
      upstreamName: m.upstreamName,
      inputPerMTok: perMTok(m.promptPrice),
      outputPerMTok: perMTok(m.completionPrice),
      contextLength: m.contextLength,
      live: m.missingSince === null,
    }));
    reply.header("cache-control", "public, max-age=60");
    return { data, settings: { blindMode: ctx.env.COMPARE_BLIND_MODE } };
  });
};
