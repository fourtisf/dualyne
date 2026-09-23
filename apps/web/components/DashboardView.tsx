"use client";

import { useEffect, useState } from "react";
import { brand } from "@refract/config";
import type { CreditsResponse, MeResponse, UsageResponse } from "@refract/shared";
import { apiFetch } from "@/lib/api";
import { publicConfig } from "@/lib/config";
import { formatRunCost, shortAddr } from "@/lib/format";
import { TopUpDialog } from "./TopUpDialog";
import { useWallet } from "./WalletProvider";

const HOLDER_MIN = "100,000";

function tierNote(me: MeResponse): string {
  switch (me.tierSource) {
    case "override":
      return "Set by the team";
    case "credits":
      return "Paid from your prepaid credits";
    case "token":
      return `Holding ${brand.tokenSymbol}. Paid for by the treasury.`;
    default:
      return `Hold ${me.token ? me.token.holderMin.toLocaleString("en-US") : HOLDER_MIN} ${brand.tokenSymbol} to unlock Holder`;
  }
}

export function DashboardView() {
  const w = useWallet();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [credits, setCredits] = useState<CreditsResponse | null>(null);
  const [topUp, setTopUp] = useState(false);
  const me = w.me;

  useEffect(() => {
    if (!me) {
      setUsage(null);
      setCredits(null);
      return;
    }
    apiFetch<UsageResponse>("/me/usage?days=7")
      .then(setUsage)
      .catch(() => setUsage(null));
    if (me.credits?.enabled) {
      apiFetch<CreditsResponse>("/me/credits")
        .then(setCredits)
        .catch(() => setCredits(null));
    }
  }, [me]);

  const creditsOn = credits && credits.enabled ? credits : null;

  if (me === undefined) {
    return (
      <div className="dash-head">
        <h1 className="grad">Dashboard</h1>
      </div>
    );
  }

  if (!me) {
    return (
      <>
        <div className="dash-head">
          <h1 className="grad">Dashboard</h1>
        </div>
        <div className="gate">
          <h2>Connect a wallet to see your usage</h2>
          <p>Your wallet is your account. Signing in takes one signature and no gas.</p>
          <button className="btn lg" type="button" id="dashConnect" onClick={w.openModal}>
            Connect wallet
          </button>
        </div>
      </>
    );
  }

  const limit = me.limits.dailyRequests;
  const days = (usage?.days ?? []).map((d) => ({
    ...d,
    lab: new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
  }));
  const max = Math.max(1, ...days.map((d) => d.requests));
  const week = days.reduce((a, d) => a + d.requests, 0);

  return (
    <>
      <div className="dash-head">
        <div>
          <div className="kick">
            <i />
            {shortAddr(me.address)}
          </div>
          <h1 className="grad">Dashboard</h1>
        </div>
        <span className="sp" />
        <button className="btn dark" type="button" id="dKeys" onClick={w.openModal}>
          Manage keys
        </button>
        <button
          className="btn"
          type="button"
          disabled={!creditsOn}
          title={creditsOn ? undefined : "Available when the Builder tier launches"}
          onClick={() => setTopUp(true)}
        >
          Top up credits
        </button>
      </div>
      <div className="dgrid">
        <div className="card">
          <div className="l">Requests today</div>
          <div className="v">
            {me.usage.today}{" "}
            <span style={{ fontSize: 16, color: "var(--muted)", letterSpacing: 0 }}>
              {limit === null ? "no cap" : `of ${limit}`}
            </span>
          </div>
          <div className="meter">
            <i style={{ width: `${limit ? Math.min(100, (me.usage.today / limit) * 100) : 0}%` }} />
          </div>
        </div>
        <div className="card">
          <div className="l">Current tier</div>
          <div className="v">{me.tierLabel}</div>
          <div className="s">{tierNote(me)}</div>
        </div>
        <div className="card">
          <div className="l">Active keys</div>
          <div className="v">
            {me.keys.count}
            {me.keys.max !== null && (
              <span style={{ fontSize: 16, color: "var(--muted)", letterSpacing: 0 }}> of {me.keys.max}</span>
            )}
          </div>
          <div className="s">
            {me.keys.count ? "Revoke any key from Manage keys" : "Create a key to call the API"}
          </div>
        </div>
        <div className="card span3">
          <div className="l" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Requests, last 7 days</span>
            <span>{week} total</span>
          </div>
          <div className="bars">
            {days.map((d) => (
              <div key={d.day}>
                <i
                  style={{ height: `${Math.max(2, (d.requests / max) * 100)}%` }}
                  title={`${d.requests} requests`}
                />
                <span>{d.lab}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card span3">
          <div className="l">Usage per key, last 7 days</div>
          {usage && usage.byKey.length ? (
            <div className="tbl" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th className="num">Requests</th>
                    <th className="num">Model cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byKey.map((k) => (
                    <tr key={k.keyId}>
                      <td>
                        <code style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>
                          {brand.keyPrefix}…{k.last4}
                        </code>
                        {k.name ? <span style={{ color: "var(--muted)" }}> · {k.name}</span> : null}
                      </td>
                      <td className="num">{k.requests}</td>
                      <td className="num">{formatRunCost(k.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="s">
              No keys yet. Create one from Manage keys, then call the API to see usage here.
            </div>
          )}
        </div>
        {creditsOn && (
          <div className="card span3">
            <div className="l" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Prepaid credits</span>
              <span>Model cost + {Math.round((creditsOn.markup - 1) * 100)}%</span>
            </div>
            <div className="v">${creditsOn.balanceUsd.toFixed(2)}</div>
            <div className="s">
              {creditsOn.balanceUsd > 0
                ? "Builder: no daily cap. Requests are paid from this balance."
                : "Top up in USDG or ETH to become a Builder: no daily cap, every model, unlimited keys."}
            </div>
            {creditsOn.deposits.length > 0 && (
              <div className="tbl" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Paid</th>
                      <th className="num">Credited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditsOn.deposits.map((d) => (
                      <tr key={d.txHash}>
                        <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                        <td>
                          {publicConfig.explorerUrl ? (
                            <a
                              href={`${publicConfig.explorerUrl}/tx/${d.txHash}`}
                              target="_blank"
                              rel="noopener"
                            >
                              {d.amount} {d.asset}
                            </a>
                          ) : (
                            `${d.amount} ${d.asset}`
                          )}
                        </td>
                        <td className="num in">+${d.usd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {creditsOn && (
        <TopUpDialog
          open={topUp}
          credits={creditsOn}
          onClose={() => setTopUp(false)}
          onCredited={() => {
            void w.refresh();
          }}
        />
      )}
    </>
  );
}
