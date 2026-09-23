"use client";

import { useState } from "react";
import { brand } from "@refract/config";
import { publicConfig } from "@/lib/config";

/** Contract address with Copy, and Buy / View chart links. Disabled until launch values are set. */
export function TokenActions() {
  const { rfxTokenAddress: ca, rfxBuyUrl, rfxChartUrl, explorerUrl } = publicConfig;
  const [label, setLabel] = useState("Copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ca);
      setLabel("Copied");
    } catch {
      setLabel("Select to copy");
    }
    setTimeout(() => setLabel("Copy"), 1600);
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
          <span>Contract address is published at launch</span>
        )}
        <button className="btn dark sm" type="button" disabled={!ca} onClick={copy}>
          {label}
        </button>
      </div>
      <div className="tk-actions">
        {rfxBuyUrl ? (
          <a className="btn" href={rfxBuyUrl} target="_blank" rel="noopener">
            Buy {brand.tokenSymbol}
          </a>
        ) : (
          <button className="btn" type="button" disabled>
            Buy {brand.tokenSymbol}
          </button>
        )}
        {rfxChartUrl ? (
          <a className="btn dark" href={rfxChartUrl} target="_blank" rel="noopener">
            View chart
          </a>
        ) : (
          <button className="btn dark" type="button" disabled>
            View chart
          </button>
        )}
      </div>
    </>
  );
}
