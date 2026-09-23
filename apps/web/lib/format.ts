export const shortAddr = (a: string): string => a.slice(0, 6) + "…" + a.slice(-4);

/** 200000 → "200K", 1048576 → "1M", 163840 → "164K" */
export function formatContext(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${Math.round((n / 1_048_576) * 10) / 10}M`.replace(".0M", "M");
  return `${Math.round(n / 1000)}K`;
}

/** USD per 1M tokens → "$1.25" / "$0.13" */
export function formatPerMTok(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
}

/** Cost of a single run → "$0.0012", "<$0.0001" */
export function formatRunCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const m = Math.round(seconds / 60);
  return m < 90 ? `${m} minutes` : `${Math.round(m / 60)} hours`;
}
