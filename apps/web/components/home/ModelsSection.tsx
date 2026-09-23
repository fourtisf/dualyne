"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { TIER_DEFAULTS, type CatalogModel, type LeaderboardResponse } from "@refract/shared";
import { publicConfig } from "@/lib/config";
import { formatContext, formatPerMTok } from "@/lib/format";
import { store } from "@/lib/storage";
import { useT } from "../LocaleProvider";
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

function RankTable({
  rows,
  name,
}: {
  rows: { id: string; r: number; w: number; n: number }[];
  name: (id: string) => string;
}) {
  const t = useT().models.lb.th;
  return (
    <div className="tbl">
      <table>
        <thead>
          <tr>
            <th />
            <th>{t.model}</th>
            <th className="num">{t.rating}</th>
            <th>{t.winRate}</th>
            <th className="num">{t.votes}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => {
            const wr = x.n ? Math.round((x.w / x.n) * 100) : 0;
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
  );
}

function Leaderboard({ models }: { models: CatalogModel[] }) {
  const { version } = useWallet();
  const t = useT().models.lb;
  const [mine, setMine] = useState<ReturnType<typeof ratings>>({ rows: [], total: 0 });
  const [community, setCommunity] = useState<LeaderboardResponse | null>(null);
  const [scope, setScope] = useState<"everyone" | "mine" | null>(null);
  useEffect(() => setMine(ratings(store.get<Match[]>("refract.matches", []))), [version]);
  useEffect(() => {
    fetch(`${publicConfig.apiUrl}/leaderboard`)
      .then((r) => (r.ok ? (r.json() as Promise<LeaderboardResponse>) : null))
      .then((d) => setCommunity(d))
      .catch(() => setCommunity(null));
  }, []);
  const name = (id: string) => models.find((m) => m.id === id)?.menuName ?? id;
  const hasCommunity = Boolean(community && community.rows.length);
  const active = scope ?? (hasCommunity ? "everyone" : "mine");

  const meta =
    active === "everyone" && community
      ? t.metaCommunity(community.totalVotes, community.blindOnly)
      : mine.total
        ? t.metaMine(mine.total, hasCommunity)
        : hasCommunity
          ? t.metaInvite
          : t.metaNone;

  const rows =
    active === "everyone" && community
      ? community.rows.map((r) => ({ id: r.modelId, r: r.rating, w: r.wins, n: r.games }))
      : mine.rows;

  return (
    <div className="lb-wrap">
      <div className="lb-top">
        <div className={hasCommunity ? "seg show" : "seg"} role="group" aria-label={t.scope}>
          <button type="button" aria-pressed={active === "mine"} onClick={() => setScope("mine")}>
            {t.yours}
          </button>
          <button
            type="button"
            aria-pressed={active === "everyone"}
            disabled={!hasCommunity}
            title={hasCommunity ? undefined : t.everyoneDisabled}
            onClick={() => setScope("everyone")}
          >
            {t.everyone}
          </button>
        </div>
        <span className="sp" />
        <span id="lbMeta">{meta}</span>
      </div>
      <div id="lbBody">
        {!rows.length ? (
          <div className="lb-empty">
            {t.empty}
            <br />
            <a className="btn dark" href="#compare">
              {t.run}
            </a>
          </div>
        ) : (
          <RankTable rows={rows} name={name} />
        )}
      </div>
    </div>
  );
}

export function ModelsSection({ models }: { models: CatalogModel[] }) {
  const [tab, setTab] = useState<"cat" | "lb">("cat");
  const t = useT().models;
  return (
    <section className="block" id="models">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            {t.kick}
          </div>
          <h2>{t.h2}</h2>
          <p>{t.p}</p>
        </div>
        <div className="seg mtabs" role="tablist" aria-label={t.tabs}>
          {(
            [
              ["cat", t.catalog],
              ["lb", t.leaderboard],
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
                  <th>{t.th.model}</th>
                  <th>{t.th.provider}</th>
                  <th>{t.th.bestFor}</th>
                  <th>{t.th.speed}</th>
                  <th>{t.th.context}</th>
                  <th>{t.th.price}</th>
                  <th>{t.th.tier}</th>
                  <th>{t.th.status}</th>
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
                    <td>{t.bestFor[m.id] ?? m.bestFor}</td>
                    <td>
                      <span className="spd" aria-label={t.speedAria(m.speed)}>
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
                        <span className="st live">{t.live}</span>
                      ) : (
                        <span className="st off">{t.unavailable}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="fine" hidden={tab !== "cat"}>
          {t.fine}
        </p>
        <div id="leaderboard" role="tabpanel" hidden={tab !== "lb"}>
          <Leaderboard models={models} />
        </div>
      </div>
    </section>
  );
}
