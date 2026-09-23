import type { CatalogModel } from "@refract/shared";
import type { FastifyPluginAsync } from "fastify";

const perMTok = (price: unknown): number | null => {
  const n = Number(price);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 10_000) / 10_000 : null;
};

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
      upstreamName: m.upstreamName,
      inputPerMTok: perMTok(m.promptPrice),
      outputPerMTok: perMTok(m.completionPrice),
      contextLength: m.contextLength,
      live: m.missingSince === null,
    }));
    reply.header("cache-control", "public, max-age=60");
    return { data };
  });
};
