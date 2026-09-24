import type { CSSProperties } from "react";
import type { CatalogModel, StatusResponse } from "@dualyne/shared";
import { getDict, type Locale } from "@/lib/i18n";
import { CompareConsole } from "../CompareConsole";
import Link from "next/link";
import { Check } from "./Check";
import { LiveStats } from "./LiveStats";

const d = (v: string) => ({ "--d": v }) as CSSProperties;

export function Hero({
  locale,
  models,
  blindMode,
  status,
}: {
  locale: Locale;
  models: CatalogModel[];
  blindMode: "optional" | "always";
  status: StatusResponse | null;
}) {
  const t = getDict(locale).hero;
  return (
    <section className="hero">
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="wrap">
        <div className="hero-text">
          <a className="badge rise" href="#api" style={d(".05s")}>
            <b>{t.badgeNew}</b>
            {t.badge}
          </a>
          <h1 className="rise" style={d(".12s")}>
            <span className="metal">{t.h1a}</span>
            <br />
            <span className="accent">{t.h1b}</span>
          </h1>
          <p className="lede rise" style={d(".24s")}>
            {t.lede}
          </p>
          <div className="ctas rise" style={d(".34s")}>
            <Link className="btn lg" href="/chat">
              {t.chat}
            </Link>
            <a className="btn dark lg" href="#compare">
              {t.compare}
            </a>
          </div>
          <div className="trust rise" style={d(".42s")}>
            {t.trust.map((x) => (
              <span key={x}>
                <Check />
                {x}
              </span>
            ))}
          </div>
          <LiveStats locale={locale} models={models} status={status} />
        </div>
        <CompareConsole models={models} blindMode={blindMode} />
      </div>
    </section>
  );
}
