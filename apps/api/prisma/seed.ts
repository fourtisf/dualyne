import { PrismaClient } from "@prisma/client";
import { MODEL_DEFS } from "@dualyne/shared";
import { pathToFileURL } from "node:url";

/**
 * Upsert the models table from packages/shared/src/models.ts.
 * Display fields are refreshed every time. The OpenRouter mapping and prices are only written
 * on first insert, so changes made by `models:resolve` and the daily job are never overwritten.
 */
export async function seedModels(prisma: PrismaClient): Promise<void> {
  for (const m of MODEL_DEFS) {
    const display = {
      name: m.name,
      menuName: m.menuName,
      provider: m.provider,
      providerColor: m.providerColor,
      bestFor: m.bestFor,
      speed: m.speed,
      minTier: m.minTier,
      sortOrder: m.sortOrder,
      openrouterFamily: m.openrouterFamily,
    };
    await prisma.model.upsert({
      where: { id: m.id },
      update: display,
      create: {
        id: m.id,
        ...display,
        openrouterId: m.openrouterId,
        upstreamName: m.upstreamName,
        promptPrice: m.promptPrice,
        completionPrice: m.completionPrice,
        contextLength: m.contextLength,
      },
    });
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const prisma = new PrismaClient();
  seedModels(prisma)
    .then(() => console.log(`Seeded ${MODEL_DEFS.length} models.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
