"use client";

import { useEffect, useState } from "react";
import { brand } from "@dualyne/config";
import type { CreditsResponse, MeResponse, UsageResponse } from "@dualyne/shared";
import { apiFetch } from "@/lib/api";
import { publicConfig } from "@/lib/config";
import { formatRunCost, shortAddr } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import { useT } from "./LocaleProvider";
import { TopUpDialog } from "./TopUpDialog";
import { useWallet } from "./WalletProvider";

const HOLDER_MIN = "100,000";

function tierNote(t: Dict["dashboard"], me: MeResponse): string {
  switch (me.tierSource) {
    case "override":
      return t.tierOverride;
    case "credits":
      return t.tierCredits;
    case "token":
      return t.tierToken;
    default:
      return t.tierHold(me.token ? me.token.holderMin.toLocaleString("en-US") : HOLDER_MIN);
  }
}

export function DashboardView() {
  const w = useWallet();
  const d = useT();
  const t = d.dashboard;
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
        <h1 className="grad">{t.title}</h1>
      </div>
    );
  }

  if (!me) {
    return (
      <>
        <div className="dash-head">
          <h1 className="grad">{t.title}</h1>
        </div>
        <div className="gate">
          <h2>{t.gateTitle}</h2>
          <p>{t.gateText}</p>
          <button className="btn lg" type="button" id="dashConnect" onClick={w.openModal}>
            {t.connect}
          </button>
        </div>
      </>
    );
  }

  const limit = me.limits.dailyRequests;
  const days = (usage?.days ?? []).map((x) => ({
    ...x,
    lab: new Date(`${x.day}T12:00:00Z`).toLocaleDateString(d.dateLocale, {
      weekday: "short",
      timeZone: "UTC",
    }),
  }));
  const max = Math.max(1, ...days.map((x) => x.requests));
  const week = days.reduce((a, x) => a + x.requests, 0);

  return (
    <>
      <div className="dash-head">
        <div>
          <div className="kick">
            <i />
            {shortAddr(me.address)}
          </div>
          <h1 className="grad">{t.title}</h1>
        </div>
        <span className="sp" />
        <button className="btn dark" type="button" id="dKeys" onClick={w.openModal}>
          {t.manageKeys}
        </button>
        <button
          className="btn"
          type="button"
          disabled={!creditsOn}
          title={creditsOn ? undefined : t.topUpSoon}
          onClick={() => setTopUp(true)}
        >
          {t.topUp}
        </button>
      </div>
      <div className="dgrid">
        <div className="card">
          <div className="l">{t.requestsToday}</div>
          <div className="v">
            {me.usage.today}{" "}
            <span style={{ fontSize: 16, color: "var(--muted)", letterSpacing: 0 }}>
              {limit === null ? t.noCap : `${t.of} ${limit}`}
            </span>
          </div>
          <div className="meter">
            <i style={{ width: `${limit ? Math.min(100, (me.usage.today / limit) * 100) : 0}%` }} />
          </div>
        </div>
        <div className="card">
          <div className="l">{t.tier}</div>
          <div className="v">{me.tierLabel}</div>
          <div className="s">{tierNote(t, me)}</div>
        </div>
        <div className="card">
          <div className="l">{t.keys}</div>
          <div className="v">
            {me.keys.count}
            {me.keys.max !== null && (
              <span style={{ fontSize: 16, color: "var(--muted)", letterSpacing: 0 }}>
                {" "}
                {t.of} {me.keys.max}
              </span>
            )}
          </div>
          <div className="s">{me.keys.count ? t.keysSome : t.keysNone}</div>
        </div>
        <div className="card span3">
          <div className="l" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{t.week}</span>
            <span>{t.total(week)}</span>
          </div>
          <div className="bars">
            {days.map((x) => (
              <div key={x.day}>
                <i
                  style={{ height: `${Math.max(2, (x.requests / max) * 100)}%` }}
                  title={t.requestsTitle(x.requests)}
                />
                <span>{x.lab}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card span3">
          <div className="l">{t.perKey}</div>
          {usage && usage.byKey.length ? (
            <div className="tbl" tabIndex={0} style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t.th.key}</th>
                    <th className="num">{t.th.requests}</th>
                    <th className="num">{t.th.cost}</th>
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
            <div className="s">{t.perKeyEmpty}</div>
          )}
        </div>
        {creditsOn && (
          <div className="card span3">
            <div className="l" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{t.credits}</span>
              <span>{t.markup(Math.round((creditsOn.markup - 1) * 100))}</span>
            </div>
            <div className="v">${creditsOn.balanceUsd.toFixed(2)}</div>
            <div className="s">{creditsOn.balanceUsd > 0 ? t.creditsOn : t.creditsOff}</div>
            {creditsOn.deposits.length > 0 && (
              <div className="tbl" tabIndex={0} style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t.th.date}</th>
                      <th>{t.th.paid}</th>
                      <th className="num">{t.th.credited}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditsOn.deposits.map((dep) => (
                      <tr key={dep.txHash}>
                        <td>{new Date(dep.createdAt).toLocaleDateString()}</td>
                        <td>
                          {publicConfig.explorerUrl ? (
                            <a
                              href={`${publicConfig.explorerUrl}/tx/${dep.txHash}`}
                              target="_blank"
                              rel="noopener"
                            >
                              {dep.amount} {dep.asset}
                            </a>
                          ) : (
                            `${dep.amount} ${dep.asset}`
                          )}
                        </td>
                        <td className="num in">+${dep.usd.toFixed(2)}</td>
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
