import Link from "next/link";
import type { CSSProperties } from "react";
import { brand } from "@refract/config";
import { TIER_DEFAULTS, type CatalogModel, type LeaderboardResponse } from "@refract/shared";
import { formatContext, formatPerMTok } from "@/lib/format";
import { getDict, href, type Locale } from "@/lib/i18n";
import { OpenWalletButton } from "./WalletProvider";

const envName = `${brand.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;

/** One model: what it is, what it costs, who can use it and how the community ranks it. */
export function ModelPage({
  locale,
  model: m,
  models,
  board,
}: {
  locale: Locale;
  model: CatalogModel;
  models: CatalogModel[];
  board: LeaderboardResponse | null;
}) {
  const d = getDict(locale);
  const t = d.modelPage;
  const h = (p: string) => href(locale, p);
  const free = m.minTier === "explorer" && m.live;
  const bestFor = d.models.bestFor[m.id] ?? m.bestFor;

  const rows = board?.rows ?? [];
  const idx = rows.findIndex((r) => r.modelId === m.id);
  const row = idx >= 0 ? rows[idx]! : null;

  const snippet = `from openai import OpenAI

client = OpenAI(base_url="${brand.apiBaseUrl}", api_key=os.environ["${envName}"])

reply = client.chat.completions.create(
    model="${m.id}",
    messages=[{"role": "user", "content": "Hello"}],
)`;

  return (
    <main className="view">
      <div className="wrap mp">
        <div className="head">
          <div className="kick">
            <i />
            <a href={h("/#models")}>{t.breadcrumb}</a>
            <span aria-hidden="true">/</span>
            {m.provider}
          </div>
          <div className="mp-title">
            <span className="mp-dot" style={{ "--c": m.providerColor } as CSSProperties} aria-hidden="true" />
            <h1 className="grad">{m.name}</h1>
            {m.live ? (
              <span className="st live">{d.models.live}</span>
            ) : (
              <span className="st off">{d.models.unavailable}</span>
            )}
          </div>
          <p>
            {t.by(m.upstreamName, m.provider)}. {bestFor}.
          </p>
        </div>

        <div className="mp-ctas">
          {free ? (
            <a className="btn lg" href={h(`/?a=${m.id}#compare`)}>
              {t.compare(m.name)}
            </a>
          ) : (
            <Link className="btn lg" href="/docs#d-models">
              {t.docs}
            </Link>
          )}
          <OpenWalletButton className="btn dark lg">{d.hero.getKey}</OpenWalletButton>
          <span className="mp-note">{free ? t.freeNote : t.keyNote}</span>
        </div>

        <div className="dgrid mp-grid">
          <div className="card">
            <div className="l">{t.speed}</div>
            <div className="v">
              <span className="spd" aria-hidden="true">
                {[1, 2, 3, 4].map((n) => (
                  <b key={n} className={n <= m.speed ? "on" : undefined} />
                ))}
              </span>{" "}
              <span className="mp-v2">{t.speedValue(m.speed)}</span>
            </div>
            <div className="s">{t.speedNote[m.speed] ?? ""}</div>
          </div>
          <div className="card">
            <div className="l">{t.context}</div>
            <div className="v">{m.contextLength ? t.contextValue(formatContext(m.contextLength)) : "—"}</div>
            <div className="s">{t.contextNote}</div>
          </div>
          <div className="card">
            <div className="l">{t.access}</div>
            <div className="v">{t.accessValue[m.minTier] ?? TIER_DEFAULTS[m.minTier].label}</div>
            <div className="s">{t.accessNote[m.minTier]}</div>
          </div>
          <div className="card">
            <div className="l">{t.input}</div>
            <div className="v">{formatPerMTok(m.inputPerMTok)}</div>
            <div className="s">{t.priceNote}</div>
          </div>
          <div className="card">
            <div className="l">{t.output}</div>
            <div className="v">{formatPerMTok(m.outputPerMTok)}</div>
            <div className="s">{t.builderNote}</div>
          </div>
          <div className="card">
            <div className="l">{t.ranking}</div>
            <div className="v">{row ? t.rankValue(idx + 1, rows.length) : t.unranked}</div>
            <div className="s">
              {row
                ? t.rankNote(row.rating, row.games ? Math.round((row.wins / row.games) * 100) : 0, row.games)
                : t.unrankedNote}
            </div>
          </div>
        </div>

        <section className="prose mp-code" aria-labelledby="mp-code">
          <h2 id="mp-code">{t.codeTitle}</h2>
          <p>
            {t.codeNoteA} <code>{m.id}</code> {t.codeNoteB}
          </p>
          <pre>
            <code>{`import os\n${snippet}`}</code>
          </pre>
        </section>

        <section className="mp-others" aria-labelledby="mp-others">
          <h2 id="mp-others">{t.others}</h2>
          <ul>
            {models
              .filter((o) => o.id !== m.id)
              .map((o) => (
                <li key={o.id}>
                  <Link href={h(`/models/${o.id}`)}>
                    <i style={{ "--c": o.providerColor } as CSSProperties} aria-hidden="true" />
                    <span>
                      {o.name}
                      <small>{d.models.bestFor[o.id] ?? o.bestFor}</small>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
