import type { PrismaClient } from "@prisma/client";
import type { Alerter } from "../lib/alert";
import type { OpenRouter, OpenRouterModel } from "../openrouter/client";

export interface VerifyResult {
  ok: boolean;
  missing: string[];
  updated: string[];
  newer: { id: string; current: string; newest: string }[];
}

/** "Anthropic: Claude Haiku 4.5" → "Claude Haiku 4.5" */
export const cleanUpstreamName = (name: string): string => name.replace(/^[^:]{1,40}:\s*/, "");

const validPrice = (p: string | undefined): p is string => {
  if (p === undefined) return false;
  const n = Number(p);
  return Number.isFinite(n) && n >= 0;
};

/** Newest non-variant model in a family (ignores ":free", ":beta" and similar variants). */
export function newestInFamily(catalog: OpenRouterModel[], family: string): OpenRouterModel | null {
  const candidates = catalog.filter((m) => m.id.startsWith(family) && !m.id.includes(":"));
  candidates.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return candidates[0] ?? null;
}

/**
 * Daily job: check every mapped OpenRouter id still exists, refresh prices, context length and
 * upstream names, record the run, and alert when a mapped id has disappeared.
 */
export async function verifyModels(
  prisma: PrismaClient,
  openrouter: OpenRouter,
  alert: Alerter,
  now: Date = new Date(),
): Promise<VerifyResult> {
  let catalog: OpenRouterModel[];
  try {
    catalog = await openrouter.models();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.modelCheck.create({ data: { ok: false, missing: [], details: { error: message } } });
    await alert(`Model check could not reach OpenRouter: ${message}`);
    return { ok: false, missing: [], updated: [], newer: [] };
  }
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const models = await prisma.model.findMany();
  const result: VerifyResult = { ok: true, missing: [], updated: [], newer: [] };

  for (const m of models) {
    const upstream = byId.get(m.openrouterId);
    if (!upstream) {
      result.missing.push(m.id);
      if (!m.missingSince) await prisma.model.update({ where: { id: m.id }, data: { missingSince: now } });
      continue;
    }
    const data: Record<string, unknown> = { lastVerifiedAt: now, missingSince: null };
    if (validPrice(upstream.pricing?.prompt)) data.promptPrice = upstream.pricing.prompt;
    if (validPrice(upstream.pricing?.completion)) data.completionPrice = upstream.pricing.completion;
    if (typeof upstream.context_length === "number") data.contextLength = upstream.context_length;
    if (upstream.name) data.upstreamName = cleanUpstreamName(upstream.name);
    await prisma.model.update({ where: { id: m.id }, data });
    result.updated.push(m.id);

    const newest = newestInFamily(catalog, m.openrouterFamily);
    if (newest && newest.id !== m.openrouterId && (newest.created ?? 0) > (upstream.created ?? 0)) {
      result.newer.push({ id: m.id, current: m.openrouterId, newest: newest.id });
    }
  }

  result.ok = result.missing.length === 0;
  await prisma.modelCheck.create({
    data: {
      ok: result.ok,
      missing: result.missing,
      details: { updated: result.updated, newer: result.newer, catalogSize: catalog.length },
    },
  });
  if (!result.ok) {
    const lines = result.missing.map((id) => {
      const m = models.find((x) => x.id === id);
      return `${id} → ${m?.openrouterId}`;
    });
    await alert(
      `OpenRouter no longer lists these mapped models:\n${lines.join("\n")}\n` +
        "Run `pnpm --filter @dualyne/api models:resolve` on the server to pick replacements.",
    );
  }
  return result;
}
