import "server-only";
import { STATIC_CATALOG, type CatalogModel } from "@dualyne/shared";

/**
 * Model catalog for server components. Reads the API (over the internal network in
 * production) and falls back to the static list when the API can't be reached, for example
 * during `next build`. Pages that use it revalidate every 60 seconds.
 */
export interface CatalogSettings {
  blindMode: "optional" | "always";
}

export interface Catalog {
  models: CatalogModel[];
  settings: CatalogSettings;
}

const FALLBACK: Catalog = { models: STATIC_CATALOG, settings: { blindMode: "optional" } };

export async function getCatalog(): Promise<Catalog> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  // During `next build` the API is usually not running; the page revalidates at runtime.
  if (!base || process.env.NEXT_PHASE === "phase-production-build") return FALLBACK;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/catalog`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return FALLBACK;
    const json = (await res.json()) as { data?: CatalogModel[]; settings?: CatalogSettings };
    if (!Array.isArray(json.data) || !json.data.length) return FALLBACK;
    return { models: json.data, settings: json.settings ?? FALLBACK.settings };
  } catch {
    return FALLBACK;
  }
}
