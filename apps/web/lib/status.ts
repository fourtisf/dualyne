import "server-only";
import type { StatusResponse } from "@dualyne/shared";

/** Service status for the status page, or null when the API can't be reached. */
export async function getStatus(): Promise<StatusResponse | null> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? ((await res.json()) as StatusResponse) : null;
  } catch {
    return null;
  }
}
