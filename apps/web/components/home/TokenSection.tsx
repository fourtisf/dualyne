import Link from "next/link";
import { brand, tokenTicker } from "@dualyne/config";
import { getDict, type Locale } from "@/lib/i18n";
import { balancePaths, fmt, type TreasuryData } from "@/lib/treasury";
import { TokenActions } from "./TokenActions";

const SAMPLE_LINE =
  "M0 150 L25 146 L50 138 L75 140 L100 126 L125 118 L150 121 L175 104 L200 96 L225 99 L250 84 L275 76 L300 70 L325 58 L350 52 L375 44 L400 34";
const SAMPLE_ROWS: [string, string, string][] = [
  ["2026-09-22", "+1,284", "−452"],
  ["2026-09-21", "+1,902", "−431"],
  ["2026-09-20", "+2,650", "−388"],
  ["2026-09-19", "+3,118", "−341"],
  ["2026-09-18", "+4,407", "−296"],
];

/**
 * Token facts, fee split and the treasury ledger. The ledger shows live numbers from the API once
 * the treasury is configured and has a recorded balance; until then it shows labelled sample data.
 */
export function TokenSection({ locale, treasury }: { locale: Locale; treasury: TreasuryData | null }) {
  const d = getDict(locale);
  const t = d.token;
  const tr = d.treasury;
  const live = treasury !== null;
  const paths = live ? balancePaths(treasury.days) : null;
  const line = paths?.line ?? SAMPLE_LINE;
  const area = paths?.area ?? `${SAMPLE_LINE} L400 170 L0 170Z`;
  const rows: [string, string, string][] = live
    ? treasury.days
        .slice(-5)
        .reverse()
        .map((x) => [fmt.day(x.day, d.dateLocale), fmt.signed(x.inUsd), fmt.signed(-x.outUsd)])
    : SAMPLE_ROWS.map(([day, i, o]) => [fmt.day(day, d.dateLocale), i, o]);
  const kpi = live
    ? {
        balance: fmt.usd(treasury.balanceUsd ?? 0),
        balanceNote: tr.today(fmt.usd(treasury.inflowTodayUsd)),
        runway: treasury.runwayDays === null ? "—" : tr.days(treasury.runwayDays.toLocaleString("en-US")),
        runwayNote:
          treasury.runwayChangeDays === null
            ? ""
            : tr.runwayChange(treasury.runwayChangeDays < 0 ? "−" : "+", Math.abs(treasury.runwayChangeDays)),
        requests: treasury.requests7d.toLocaleString("en-US"),
        requestsNote:
          treasury.requestsChangePct === null
            ? ""
            : tr.requestsChange(
                treasury.requestsChangePct < 0 ? "−" : "+",
                Math.abs(treasury.requestsChangePct),
              ),
      }
    : {
        balance: "$18,420",
        balanceNote: tr.today("$832"),
        runway: tr.days("41"),
        runwayNote: tr.runwayChange("+", 2),
        requests: "312,480",
        requestsNote: tr.requestsChange("+", 18),
      };
  return (
    <section className="block" id="token">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            {t.kick}
          </div>
          <h2>{t.h2}</h2>
          <p>{t.p}</p>
        </div>
        <div className="token">
          <div className="tk-card">
            <div className="tk-sym">
              <span className="tk-coin" aria-hidden="true" />
              <div>
                <h3>{tokenTicker}</h3>
                <span>{brand.tokenName}</span>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>{t.supply}</dt>
                <dd>1,000,000,000</dd>
              </div>
              <div>
                <dt>{t.fee}</dt>
                <dd>{t.feeValue}</dd>
              </div>
              <div>
                <dt>{t.team}</dt>
                <dd>{t.teamValue}</dd>
              </div>
              <div>
                <dt>{t.holder}</dt>
                <dd>100,000 {brand.tokenSymbol}</dd>
              </div>
            </dl>
            <TokenActions />
          </div>
          <div className="tk-card">
            <div className="tk-head">
              <h4>{t.splitTitle}</h4>
              <span className="sample">{t.proposal}</span>
            </div>
            <div className="split" aria-hidden="true">
              <i style={{ width: "70%", background: "linear-gradient(90deg,#67E8F9,#8B5CF6)" }} />
              <i style={{ width: "20%", background: "#F472B6" }} />
              <i style={{ width: "10%", background: "#FBBF24" }} />
            </div>
            <div className="legend">
              <div>
                <i style={{ background: "#8B5CF6" }} />
                <span>
                  <b>{t.split[0]![0]}</b>
                  <small>{t.split[0]![1]}</small>
                </span>
                <em>70%</em>
              </div>
              <div>
                <i style={{ background: "#F472B6" }} />
                <span>
                  <b>{t.split[1]![0]}</b>
                  <small>{t.split[1]![1]}</small>
                </span>
                <em>20%</em>
              </div>
              <div>
                <i style={{ background: "#FBBF24" }} />
                <span>
                  <b>{t.split[2]![0]}</b>
                  <small>{t.split[2]![1]}</small>
                </span>
                <em>10%</em>
              </div>
            </div>
          </div>
        </div>
        <p className="fine">
          {t.disclaimer} <Link href="/terms#token">{t.terms}</Link>.
        </p>
        <div className="subhead">
          <h3>{tr.title}</h3>
          <p>{tr.p}</p>
          {!live && <span className="sample">{tr.sample}</span>}
        </div>
        <div className="ledger" id="ledger">
          <div className="lg-top">
            <div className="kpi">
              <div className="l">{tr.balance}</div>
              <div className="v">{kpi.balance}</div>
              <div className="d">{kpi.balanceNote}</div>
            </div>
            <div className="kpi">
              <div className="l">{tr.runway}</div>
              <div className="v">{kpi.runway}</div>
              {kpi.runwayNote && (
                <div className={kpi.runwayNote.startsWith("−") ? "d neg" : "d"}>{kpi.runwayNote}</div>
              )}
            </div>
            <div className="kpi">
              <div className="l">{tr.requests}</div>
              <div className="v">{kpi.requests}</div>
              {kpi.requestsNote && (
                <div className={kpi.requestsNote.startsWith("−") ? "d neg" : "d"}>{kpi.requestsNote}</div>
              )}
            </div>
          </div>
          <div className="lg-body">
            <div className="lg-chart">
              <div className="l">
                <span>{tr.chart}</span>
                {!live && <span className="sample">{tr.sample}</span>}
              </div>
              <svg
                viewBox="0 0 400 170"
                preserveAspectRatio="none"
                style={{ width: "100%", height: 190, marginTop: 14 }}
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="lf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#67E8F9" stopOpacity=".22" />
                    <stop offset="1" stopColor="#67E8F9" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g stroke="rgba(255,255,255,.06)">
                  <line x1="0" y1="42" x2="400" y2="42" />
                  <line x1="0" y1="85" x2="400" y2="85" />
                  <line x1="0" y1="128" x2="400" y2="128" />
                </g>
                <path d={area} fill="url(#lf)" />
                <path d={line} fill="none" stroke="#67E8F9" strokeWidth="1.8" />
              </svg>
            </div>
            <div className="tbl" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>{tr.th.day}</th>
                    <th className="num">{tr.th.in}</th>
                    <th className="num">{tr.th.out}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([day, i, o]) => (
                    <tr key={day}>
                      <td>{day}</td>
                      <td className="num in">{i}</td>
                      <td className="num">{o}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
