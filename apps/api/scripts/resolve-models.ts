/**
 * Show how each Dualyne model maps onto OpenRouter's live catalog, and update a mapping.
 *
 *   pnpm --filter @dualyne/api models:resolve
 *   pnpm --filter @dualyne/api models:resolve --set gpt=openai/gpt-5.1
 *
 * Run it on the server (it needs OPENROUTER_API_KEY and DATABASE_URL). After --set, the daily
 * check refreshes prices on its next run; run with --verify to refresh immediately.
 */
import { PrismaClient } from "@prisma/client";
import { parseArgs } from "node:util";
import { loadEnv } from "../src/env";
import { OpenRouter } from "../src/openrouter/client";
import { cleanUpstreamName, newestInFamily, verifyModels } from "../src/jobs/verifyModels";

const { values } = parseArgs({
  options: {
    set: { type: "string", multiple: true },
    verify: { type: "boolean", default: false },
  },
});

async function main() {
  const env = loadEnv();
  const prisma = new PrismaClient();
  const openrouter = new OpenRouter({
    baseUrl: env.OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    appUrl: `https://${env.SITE_DOMAIN}`,
    appTitle: env.OPENROUTER_APP_TITLE,
  });
  try {
    const catalog = await openrouter.models();
    const byId = new Map(catalog.map((m) => [m.id, m]));

    for (const pair of values.set ?? []) {
      const [id, orId] = pair.split("=");
      if (!id || !orId) throw new Error(`--set expects dualyneId=openrouter/id, got "${pair}"`);
      const upstream = byId.get(orId);
      if (!upstream) throw new Error(`"${orId}" is not in OpenRouter's catalog`);
      const model = await prisma.model.findUnique({ where: { id } });
      if (!model) throw new Error(`No Dualyne model "${id}"`);
      await prisma.model.update({
        where: { id },
        data: {
          openrouterId: orId,
          upstreamName: upstream.name ? cleanUpstreamName(upstream.name) : orId,
          missingSince: null,
          ...(upstream.pricing?.prompt ? { promptPrice: upstream.pricing.prompt } : {}),
          ...(upstream.pricing?.completion ? { completionPrice: upstream.pricing.completion } : {}),
          ...(typeof upstream.context_length === "number" ? { contextLength: upstream.context_length } : {}),
        },
      });
      console.log(`Updated ${id}: ${model.openrouterId} → ${orId}`);
    }

    if (values.verify) {
      const r = await verifyModels(prisma, openrouter, async (t) => console.warn(t));
      console.log(`Verified. Missing: ${r.missing.join(", ") || "none"}`);
    }

    const models = await prisma.model.findMany({ orderBy: { sortOrder: "asc" } });
    for (const m of models) {
      const found = byId.has(m.openrouterId);
      const family = catalog
        .filter((c) => c.id.startsWith(m.openrouterFamily) && !c.id.includes(":"))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .slice(0, 5);
      const newest = newestInFamily(catalog, m.openrouterFamily);
      console.log(`\n${m.id} (${m.minTier})`);
      console.log(`  mapped:  ${m.openrouterId}  ${found ? "OK" : "MISSING from OpenRouter"}`);
      if (newest && newest.id !== m.openrouterId) console.log(`  newest in family: ${newest.id}`);
      console.log(`  recent in family: ${family.map((f) => f.id).join(", ") || "(none)"}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
