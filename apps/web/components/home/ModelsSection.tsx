"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { TIER_DEFAULTS, type CatalogModel } from "@refract/shared";
import { formatContext, formatPerMTok } from "@/lib/format";
import { store } from "@/lib/storage";
import { useWallet } from "../WalletProvider";

interface Match {
  a: string;
  b: string;
  w: "a" | "b" | "tie";
}

/** Local Elo from this browser's votes (K=24, start 1000), exactly as in the prototype. */
function ratings(ms: Match[]) {
  const R: Record<string, number> = {};
  const W: Record<string, number> = {};
  const N: Record<string, number> = {};
  const g = (id: string) => (R[id] ??= 1000);
  ms.forEach((m) => {
    const ra = g(m.a);
    const rb = g(m.b);
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const sa = m.w === "a" ? 1 : m.w === "b" ? 0 : 0.5;
    if (m.a === m.b) return;
    R[m.a] = ra + 24 * (sa - ea);
    R[m.b] = rb + 24 * (1 - sa - (1 - ea));
    N[m.a] = (N[m.a] ?? 0) + 1;
    N[m.b] = (N[m.b] ?? 0) + 1;
    if (m.w === "a") W[m.a] = (W[m.a] ?? 0) + 1;
    if (m.w === "b") W[m.b] = (W[m.b] ?? 0) + 1;
  });
  return {
    rows: Object.keys(R)
      .map((id) => ({ id, r: Math.round(R[id]!), w: W[id] ?? 0, n: N[id] ?? 0 }))
      .filter((x) => x.n)
      .sort((a, b) => b.r - a.r),
    total: ms.length,
  };
}

function Leaderboard({ models }: { models: CatalogModel[] }) {
  const { version } = useWallet();
  const [data, setData] = useState<ReturnType<typeof ratings>>({ rows: [], total: 0 });
  useEffect(() => setData(ratings(store.get<Match[]>("refract.matches", []))), [version]);
  const name = (id: string) => models.find((m) => m.id === id)?.menuName ?? id;
  const { rows, total } = data;

  return (
    <div className="lb-wrap">
      <div className="lb-top">
        <div className="seg" role="group" aria-label="Leaderboard scope">
          <button type="button" aria-pressed="true">
            Your votes
          </button>
          <button type="button" disabled title="Goes live with the production backend">
            Everyone
          </button>
        </div>
        <span className="sp" />
        <span id="lbMeta">
          {total
            ? `Based on your ${total} vote${total > 1 ? "s" : ""}. Community rankings open at launch.`
            : "Community rankings open at launch."}
        </span>
      </div>
      <div id="lbBody">
        {!rows.length ? (
          <div className="lb-empty">
            No votes yet. Run a comparison and pick the better answer to start your ranking.
            <br />
            <a className="btn dark" href="#compare">
              Run a comparison
            </a>
          </div>
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Model</th>
                  <th className="num">Rating</th>
                  <th>Win rate</th>
                  <th className="num">Votes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x, i) => {
                  const wr = Math.round((x.w / x.n) * 100);
                  return (
                    <tr key={x.id} className={i === 0 ? "first" : ""}>
                      <td className="rank">{i + 1}</td>
                      <td style={{ color: "var(--text)", fontWeight: 500 }}>{name(x.id)}</td>
                      <td className="num elo">{x.r}</td>
                      <td>
                        <div className="wr">
                          <div className="bar2">
                            <i style={{ width: `${wr}%` }} />
                          </div>
                          <span>{wr}%</span>
                        </div>
                      </td>
                      <td className="num">{x.n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelsSection({ models }: { models: CatalogModel[] }) {
  const [tab, setTab] = useState<"cat" | "lb">("cat");
  return (
    <section className="block" id="models">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            Models
          </div>
          <h2>Every leading model, one endpoint.</h2>
          <p>Browse the catalog, or see how models rank when people compare them head to head.</p>
        </div>
        <div className="seg mtabs" role="tablist" aria-label="Models view">
          {(
            [
              ["cat", "Catalog"],
              ["lb", "Leaderboard"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              aria-controls={k === "cat" ? "mt-cat" : "leaderboard"}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="models" id="mt-cat" role="tabpanel" hidden={tab !== "cat"}>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Best for</th>
                  <th>Speed</th>
                  <th>Context</th>
                  <th>In / out per 1M</th>
                  <th>Tier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <small>{m.upstreamName}</small>
                    </td>
                    <td>
                      <span className="prov">
                        <i style={{ "--c": m.providerColor } as CSSProperties} />
                        {m.provider}
                      </span>
                    </td>
                    <td>{m.bestFor}</td>
                    <td>
                      <span className="spd" aria-label={`Speed ${m.speed} of 4`}>
                        {[1, 2, 3, 4].map((n) => (
                          <b key={n} className={n <= m.speed ? "on" : undefined} />
                        ))}
                      </span>
                    </td>
                    <td className="mono">{formatContext(m.contextLength)}</td>
                    <td className="mono">
                      {m.inputPerMTok === null
                        ? "—"
                        : `${formatPerMTok(m.inputPerMTok)} / ${formatPerMTok(m.outputPerMTok)}`}
                    </td>
                    <td>{TIER_DEFAULTS[m.minTier].label}</td>
                    <td>
                      {m.live ? (
                        <span className="st live">Live</span>
                      ) : (
                        <span className="st off">Unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="fine" hidden={tab !== "cat"}>
          Prices are what the provider charges per million input / output tokens. Explorer and Holder requests
          are free, paid for by the treasury; Builder pays cost + 15%.
        </p>
        <div id="leaderboard" role="tabpanel" hidden={tab !== "lb"}>
          <Leaderboard models={models} />
        </div>
      </div>
    </section>
  );
}
