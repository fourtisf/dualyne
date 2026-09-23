"use client";

import { brand } from "@dualyne/config";
import { publicConfig } from "@/lib/config";
import { useCopy } from "@/lib/useCopy";
import { useT } from "../LocaleProvider";
import { socialIcons } from "../Social";

/**
 * Contract address with Copy, Buy / View chart, and the community links. Until launch the CA
 * reads "Coming soon" (still copyable) and the buttons without a URL are disabled.
 */
export function TokenActions() {
  const { dlynTokenAddress: ca, dlynBuyUrl, dlynChartUrl, explorerUrl } = publicConfig;
  const d = useT();
  const t = d.token;
  const value = ca || t.caSoon;
  const { state, copy } = useCopy();
  const community = [
    { key: "x" as const, url: brand.social.x, label: t.followX },
    { key: "telegram" as const, url: brand.social.telegram, label: t.joinTelegram },
  ];
  return (
    <>
      <div className="ca">
        <span className="ca-lbl">{t.caLabel}</span>
        {ca && explorerUrl ? (
          <a href={`${explorerUrl}/token/${ca}`} target="_blank" rel="noopener" className="ca-addr">
            {ca}
          </a>
        ) : (
          <span className="ca-addr">{value}</span>
        )}
        <button
          className="btn dark sm"
          type="button"
          onClick={() => copy(value)}
          aria-label={`${d.copy[state]}: ${t.caLabel}`}
        >
          {d.copy[state]}
        </button>
      </div>
      <div className="tk-actions">
        {dlynBuyUrl ? (
          <a className="btn" href={dlynBuyUrl} target="_blank" rel="noopener">
            {t.buy}
          </a>
        ) : (
          <button className="btn" type="button" disabled>
            {t.buy}
          </button>
        )}
        {dlynChartUrl ? (
          <a className="btn dark" href={dlynChartUrl} target="_blank" rel="noopener">
            {t.chart}
          </a>
        ) : (
          <button className="btn dark" type="button" disabled>
            {t.chart}
          </button>
        )}
      </div>
      <div className="tk-community" role="group" aria-label={t.community}>
        {community.map((c) =>
          c.url ? (
            <a key={c.key} className="btn dark sm" href={c.url} target="_blank" rel="noopener">
              {socialIcons[c.key]}
              {c.label}
            </a>
          ) : (
            <button key={c.key} className="btn dark sm" type="button" disabled>
              {socialIcons[c.key]}
              {c.label}
              <span className="soon-tag">{t.soon}</span>
            </button>
          ),
        )}
      </div>
    </>
  );
}
