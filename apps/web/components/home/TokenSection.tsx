import Link from "next/link";
import { brand, tokenTicker } from "@refract/config";
import { balancePaths, fmt, type TreasuryData } from "@/lib/treasury";
import { TokenActions } from "./TokenActions";

const SAMPLE_LINE =
  "M0 150 L25 146 L50 138 L75 140 L100 126 L125 118 L150 121 L175 104 L200 96 L225 99 L250 84 L275 76 L300 70 L325 58 L350 52 L375 44 L400 34";
const SAMPLE_ROWS: [string, string, string][] = [
  ["Sep 22", "+1,284", "−452"],
  ["Sep 21", "+1,902", "−431"],
  ["Sep 20", "+2,650", "−388"],
  ["Sep 19", "+3,118", "−341"],
  ["Sep 18", "+4,407", "−296"],
];

/**
 * Token facts, fee split and the treasury ledger. The ledger shows live numbers from the API once
 * the treasury is configured and has a recorded balance; until then it shows labelled sample data.
 */
export function TokenSection({ treasury }: { treasury: TreasuryData | null }) {
  const live = treasury !== null;
  const paths = live ? balancePaths(treasury.days) : null;
  const line = paths?.line ?? SAMPLE_LINE;
  const area = paths?.area ?? `${SAMPLE_LINE} L400 170 L0 170Z`;
  const rows: [string, string, string][] = live
    ? treasury.days
        .slice(-5)
        .reverse()
        .map((d) => [fmt.day(d.day), fmt.signed(d.inUsd), fmt.signed(-d.outUsd)])
    : SAMPLE_ROWS;
  const kpi = live
    ? {
        balance: fmt.usd(treasury.balanceUsd ?? 0),
        balanceNote: `+ ${fmt.usd(treasury.inflowTodayUsd)} today`,
        runway: treasury.runwayDays === null ? "—" : `${treasury.runwayDays.toLocaleString("en-US")} days`,
        runwayNote:
          treasury.runwayChangeDays === null
            ? ""
            : `${treasury.runwayChangeDays < 0 ? "−" : "+"} ${Math.abs(treasury.runwayChangeDays)} days this week`,
        requests: treasury.requests7d.toLocaleString("en-US"),
        requestsNote:
          treasury.requestsChangePct === null
            ? ""
            : `${treasury.requestsChangePct < 0 ? "−" : "+"} ${Math.abs(treasury.requestsChangePct)}% week over week`,
      }
    : {
        balance: "$18,420",
        balanceNote: "+ $832 today",
        runway: "41 days",
        runwayNote: "+ 2 days this week",
        requests: "312,480",
        requestsNote: "+ 18% week over week",
      };
  return (
    <section className="block" id="token">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            Token
          </div>
          <h2>The token that pays for the compute.</h2>
          <p>Every trade adds to the treasury that funds free access. Holding it raises your limits.</p>
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
                <dt>Total supply</dt>
                <dd>1,000,000,000</dd>
              </div>
              <div>
                <dt>Trade fee</dt>
                <dd>1% to the treasury</dd>
              </div>
              <div>
                <dt>Team allocation</dt>
                <dd>None at launch</dd>
              </div>
              <div>
                <dt>Holder tier</dt>
                <dd>100,000 {brand.tokenSymbol}</dd>
              </div>
            </dl>
            <TokenActions />
          </div>
          <div className="tk-card">
            <div className="tk-head">
              <h4>Where each fee goes</h4>
              <span className="sample">Proposal</span>
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
                  <b>Inference treasury</b>
                  <small>Pays for every free request on the platform.</small>
                </span>
                <em>70%</em>
              </div>
              <div>
                <i style={{ background: "#F472B6" }} />
                <span>
                  <b>Product development</b>
                  <small>New models, features and infrastructure.</small>
                </span>
                <em>20%</em>
              </div>
              <div>
                <i style={{ background: "#FBBF24" }} />
                <span>
                  <b>Liquidity</b>
                  <small>Keeps trading deep and stable.</small>
                </span>
                <em>10%</em>
              </div>
            </div>
          </div>
        </div>
        <p className="fine">
          {tokenTicker} is a utility token that raises your usage limits on {brand.name}. It is not an
          investment, share or promise of profit, and its price can fall to zero. Check the rules where you
          live before buying. See the <Link href="/terms#token">Terms</Link>.
        </p>
        <div className="subhead">
          <h3>Treasury</h3>
          <p>Every fee in and every request out, published daily.</p>
          {!live && <span className="sample">Sample data</span>}
        </div>
        <div className="ledger" id="ledger">
          <div className="lg-top">
            <div className="kpi">
              <div className="l">Treasury balance</div>
              <div className="v">{kpi.balance}</div>
              <div className="d">{kpi.balanceNote}</div>
            </div>
            <div className="kpi">
              <div className="l">Runway at current usage</div>
              <div className="v">{kpi.runway}</div>
              {kpi.runwayNote && (
                <div className={kpi.runwayNote.startsWith("−") ? "d neg" : "d"}>{kpi.runwayNote}</div>
              )}
            </div>
            <div className="kpi">
              <div className="l">Requests served, 7 days</div>
              <div className="v">{kpi.requests}</div>
              {kpi.requestsNote && (
                <div className={kpi.requestsNote.startsWith("−") ? "d neg" : "d"}>{kpi.requestsNote}</div>
              )}
            </div>
          </div>
          <div className="lg-body">
            <div className="lg-chart">
              <div className="l">
                <span>Balance, last 30 days</span>
                {!live && <span className="sample">Sample data</span>}
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
                <path
                  d={line}
                  fill="none"
                  stroke="#67E8F9"
                  strokeWidth="1.8"
                />
              </svg>
            </div>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="num">Fees in</th>
                    <th className="num">Inference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([d, i, o]) => (
                    <tr key={d}>
                      <td>{d}</td>
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
