import type { CSSProperties } from "react";
import type { CatalogModel, StatusResponse } from "@dualyne/shared";
import { getDict, type Locale } from "@/lib/i18n";
import { Check } from "./Check";
import { HeroAsk } from "./HeroAsk";
import { LiveStats } from "./LiveStats";

const d = (v: string) => ({ "--d": v }) as CSSProperties;

export function Hero({
  locale,
  models,
  status,
}: {
  locale: Locale;
  models: CatalogModel[];
  status: StatusResponse | null;
}) {
  const dict = getDict(locale);
  const t = dict.hero;
  return (
    <section className="hero">
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="wrap">
        <div className="hero-text">
          <a className="badge rise" href="/about" style={d(".05s")}>
            <b>{t.badgeNew}</b>
            {t.badgeFree}
          </a>
          <h1 className="rise" style={d(".12s")}>
            <span className="metal">{t.h1a}</span>
            <br />
            <span className="accent">{t.h1b}</span>
          </h1>
          <p className="lede rise" style={d(".24s")}>
            {t.lede}
          </p>
          <HeroAsk models={models} />
          <p className="ask-or rise" style={d(".38s")}>
            {dict.ask.or} <a href="#compare">{dict.ask.compare} →</a>
          </p>
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
      </div>
    </section>
  );
}
