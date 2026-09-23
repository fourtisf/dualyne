"use client";

import { useState } from "react";
import { publicConfig } from "@/lib/config";
import { useT } from "../LocaleProvider";

/** Contract address with Copy, and Buy / View chart links. Disabled until launch values are set. */
export function TokenActions() {
  const { dlynTokenAddress: ca, dlynBuyUrl, dlynChartUrl, explorerUrl } = publicConfig;
  const d = useT();
  const t = d.token;
  const [state, setState] = useState<"copy" | "copied" | "select">("copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ca);
      setState("copied");
    } catch {
      setState("select");
    }
    setTimeout(() => setState("copy"), 1600);
  };
  return (
    <>
      <div className="ca">
        {ca ? (
          explorerUrl ? (
            <a href={`${explorerUrl}/token/${ca}`} target="_blank" rel="noopener" className="ca-addr">
              {ca}
            </a>
          ) : (
            <span className="ca-addr">{ca}</span>
          )
        ) : (
          <span>{t.caPending}</span>
        )}
        <button className="btn dark sm" type="button" disabled={!ca} onClick={copy}>
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
    </>
  );
}
