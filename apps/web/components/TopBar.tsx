"use client";

import { brand } from "@dualyne/config";
import { publicConfig } from "@/lib/config";
import { useCopy } from "@/lib/useCopy";
import { useT } from "./LocaleProvider";
import { socialIcons, socialLabel } from "./Social";

/**
 * Slim bar above the navigation: the token's contract address (copyable) when the token is shown,
 * otherwise a short announcement; the community links on the right either way.
 */
export function TopBar() {
  const d = useT();
  const t = d.token;
  const ca = publicConfig.dlynTokenAddress;
  const value = ca || t.caSoon;
  const { state, copy } = useCopy();

  return (
    <div className="topbar">
      <div className="wrap">
        {brand.tokenEnabled ? (
          <div className="tb-ca">
            <span className="tb-tick">${brand.tokenSymbol}</span>
            <span className="ca-lbl">{t.caLabel}</span>
            <span className="tb-addr" title={value}>
              {value}
            </span>
            <button
              className="tb-copy"
              type="button"
              onClick={() => copy(value)}
              aria-label={`${d.copy[state]}: ${t.caLabel}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 9h10v10H9zM5 15V5h10"
                />
              </svg>
              <span aria-live="polite">{d.copy[state]}</span>
            </button>
          </div>
        ) : (
          <a className="tb-news" href="https://t.me/dualynebot" target="_blank" rel="noopener">
            <b>{d.topbar.new}</b>
            <span>{d.topbar.telegram}</span>
            <span className="arr" aria-hidden="true">
              →
            </span>
          </a>
        )}
        <div className="tb-social">
          {(["x", "telegram"] as const).map((k) =>
            brand.social[k] ? (
              <a
                key={k}
                href={brand.social[k]}
                target="_blank"
                rel="noopener"
                aria-label={d.footer.on(socialLabel[k])}
              >
                {socialIcons[k]}
                <span className="lbl">{socialLabel[k]}</span>
              </a>
            ) : (
              <span
                key={k}
                className="soon"
                role="img"
                aria-label={d.footer.soon(socialLabel[k])}
                title={d.footer.soon(socialLabel[k])}
              >
                {socialIcons[k]}
                <span className="lbl">{socialLabel[k]}</span>
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
