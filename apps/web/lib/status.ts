import "server-only";
import type { StatusResponse } from "@dualyne/shared";

/**
 * Service status, or null when the API can't be reached. The status page asks for it fresh; the
 * home page passes `revalidate` so it stays a cached page.
 */
export async function getStatus(opts: { revalidate?: number } = {}): Promise<StatusResponse | null> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  // Cached callers (the home page) skip the API during `next build`; the page revalidates at runtime.
  if (!base || (opts.revalidate && process.env.NEXT_PHASE === "phase-production-build")) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/status`, {
      ...(opts.revalidate ? { next: { revalidate: opts.revalidate } } : { cache: "no-store" as const }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? ((await res.json()) as StatusResponse) : null;
  } catch {
    return null;
  }
}
