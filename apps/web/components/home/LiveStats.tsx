import Link from "next/link";
import type { CatalogModel, StatusResponse } from "@dualyne/shared";
import { getDict, type Locale } from "@/lib/i18n";

/** Median of the per-model first-token times the status endpoint reports, in seconds. */
function medianFirstWord(status: StatusResponse | null): number | null {
  const xs = (status?.models ?? [])
    .map((m) => m.ttftMs)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  const ms = xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return Math.round(ms / 100) / 10;
}

/**
 * A strip of live numbers under the hero: service state, models and providers live, free models,
 * median time to first word. Every figure comes from the catalog and /status; nothing is shown
 * that the API didn't report.
 */
export function LiveStats({
  locale,
  models,
  status,
}: {
  locale: Locale;
  models: CatalogModel[];
  status: StatusResponse | null;
}) {
  const t = getDict(locale).stats;
  const live = models.filter((m) => m.live);
  const providers = new Set(live.map((m) => m.provider)).size;
  const free = live.filter((m) => m.minTier === "explorer").length;
  const ttft = medianFirstWord(status);
  const state = status?.status ?? null;
  return (
    <Link className="livestats rise" href="/status" style={{ "--d": ".5s" } as React.CSSProperties}>
      {state && (
        <span className={`ls-state ${state}`}>
          <i />
          {t.state[state]}
        </span>
      )}
      {live.length > 0 && (
        <span>
          <b>{live.length}</b> {t.models}
        </span>
      )}
      {providers > 0 && (
        <span>
          <b>{providers}</b> {t.providers}
        </span>
      )}
      {free > 0 && (
        <span>
          <b>{free}</b> {t.free}
        </span>
      )}
      {ttft !== null && (
        <span>
          <b>{ttft.toFixed(1)}s</b> {t.ttft}
        </span>
      )}
    </Link>
  );
}
