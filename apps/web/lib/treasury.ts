import "server-only";

export interface TreasuryData {
  configured: true;
  updatedAt: string | null;
  balanceUsd: number | null;
  inflowTodayUsd: number;
  runwayDays: number | null;
  runwayChangeDays: number | null;
  requests7d: number;
  requestsChangePct: number | null;
  days: { day: string; inUsd: number; outUsd: number; balanceUsd: number | null }[];
}

/**
 * Live treasury numbers from the API, or null (the section then keeps its labelled sample data).
 * Returns data only once a balance has actually been recorded.
 */
export async function getTreasury(): Promise<TreasuryData | null> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!base || process.env.NEXT_PHASE === "phase-production-build") return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/treasury`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TreasuryData | { configured: false };
    return json.configured && json.balanceUsd !== null ? json : null;
  } catch {
    return null;
  }
}

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/** SVG paths for the 30-day balance chart in the prototype's 400×170 viewBox. */
export function balancePaths(days: TreasuryData["days"]): { line: string; area: string } | null {
  const pts = days.map((d, i) => ({ i, v: d.balanceUsd })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (i: number) => Math.round((i / (days.length - 1)) * 400);
  const y = (v: number) => (max === min ? 92 : Math.round(150 - ((v - min) / (max - min)) * 116));
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)} ${y(p.v)}`).join(" ");
  const area = `${line} L${x(pts.at(-1)!.i)} 170 L${x(pts[0]!.i)} 170Z`;
  return { line, area };
}

/** Formatting helpers for the ledger. */
export const fmt = {
  usd: (n: number) => `$${money(n)}`,
  signed: (n: number, plus = "+", minus = "−") =>
    Math.round(Math.abs(n)) === 0 ? "0" : `${n < 0 ? minus : plus}${money(Math.abs(n))}`,
  day: (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
};
