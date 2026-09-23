import "server-only";
import type { LeaderboardResponse } from "@refract/shared";

/** Community leaderboard for server components, or null when it can't be read. */
export async function getLeaderboard(): Promise<LeaderboardResponse | null> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!base || process.env.NEXT_PHASE === "phase-production-build") return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/leaderboard`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as LeaderboardResponse) : null;
  } catch {
    return null;
  }
}
