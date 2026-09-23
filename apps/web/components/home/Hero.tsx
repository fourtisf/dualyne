import type { CSSProperties } from "react";
import type { CatalogModel } from "@dualyne/shared";
import { getDict, type Locale } from "@/lib/i18n";
import { CompareConsole } from "../CompareConsole";
import { OpenWalletButton } from "../WalletProvider";
import { Check } from "./Check";

const d = (v: string) => ({ "--d": v }) as CSSProperties;

export function Hero({
  locale,
  models,
  blindMode,
}: {
  locale: Locale;
  models: CatalogModel[];
  blindMode: "optional" | "always";
}) {
  const t = getDict(locale).hero;
  return (
    <section className="hero">
      <div className="wrap">
        <div className="hero-text">
          <a className="badge rise" href="#api" style={d(".05s")}>
            <b>{t.badgeNew}</b>
            {t.badge}
          </a>
          <h1 className="grad rise" style={d(".12s")}>
            {t.h1a}
            <br />
            {t.h1b}
          </h1>
          <p className="lede rise" style={d(".24s")}>
            {t.lede}
          </p>
          <div className="ctas rise" style={d(".34s")}>
            <a className="btn lg" href="#compare">
              {t.start}
            </a>
            <OpenWalletButton className="btn dark lg">{t.getKey}</OpenWalletButton>
          </div>
          <div className="trust rise" style={d(".42s")}>
            {t.trust.map((x) => (
              <span key={x}>
                <Check />
                {x}
              </span>
            ))}
          </div>
        </div>
        <CompareConsole models={models} blindMode={blindMode} />
      </div>
    </section>
  );
}
