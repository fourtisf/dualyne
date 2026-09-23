import "server-only";
import { STATIC_CATALOG, type CatalogModel } from "@refract/shared";

/**
 * Model catalog for server components. Reads the API (over the internal network in
 * production) and falls back to the static list when the API can't be reached, for example
 * during `next build`. Pages that use it revalidate every 60 seconds.
 */
export async function getCatalog(): Promise<CatalogModel[]> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  // During `next build` the API is usually not running; the page revalidates at runtime.
  if (!base || process.env.NEXT_PHASE === "phase-production-build") return STATIC_CATALOG;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/catalog`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return STATIC_CATALOG;
    const json = (await res.json()) as { data?: CatalogModel[] };
    return Array.isArray(json.data) && json.data.length ? json.data : STATIC_CATALOG;
  } catch {
    return STATIC_CATALOG;
  }
}
