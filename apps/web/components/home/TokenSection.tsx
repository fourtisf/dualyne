import Link from "next/link";
import { brand, tokenTicker } from "@refract/config";

/**
 * Token facts, fee split and the treasury ledger. Everything in the ledger is sample data until
 * the treasury jobs ship, and is labelled as such.
 */
export function TokenSection() {
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
            <div className="ca">
              <span>Contract address is published at launch</span>
              <button className="btn dark sm" type="button" disabled>
                Copy
              </button>
            </div>
            <div className="tk-actions">
              <button className="btn" type="button" disabled>
                Buy {brand.tokenSymbol}
              </button>
              <button className="btn dark" type="button" disabled>
                View chart
              </button>
            </div>
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
          <span className="sample">Sample data</span>
        </div>
        <div className="ledger" id="ledger">
          <div className="lg-top">
            <div className="kpi">
              <div className="l">Treasury balance</div>
              <div className="v">$18,420</div>
              <div className="d">+ $832 today</div>
            </div>
            <div className="kpi">
              <div className="l">Runway at current usage</div>
              <div className="v">41 days</div>
              <div className="d">+ 2 days this week</div>
            </div>
            <div className="kpi">
              <div className="l">Requests served, 7 days</div>
              <div className="v">312,480</div>
              <div className="d">+ 18% week over week</div>
            </div>
          </div>
          <div className="lg-body">
            <div className="lg-chart">
              <div className="l">
                <span>Balance, last 30 days</span>
                <span className="sample">Sample data</span>
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
                <path
                  d="M0 150 L25 146 L50 138 L75 140 L100 126 L125 118 L150 121 L175 104 L200 96 L225 99 L250 84 L275 76 L300 70 L325 58 L350 52 L375 44 L400 34 L400 170 L0 170Z"
                  fill="url(#lf)"
                />
                <path
                  d="M0 150 L25 146 L50 138 L75 140 L100 126 L125 118 L150 121 L175 104 L200 96 L225 99 L250 84 L275 76 L300 70 L325 58 L350 52 L375 44 L400 34"
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
                  {[
                    ["Sep 22", "+1,284", "−452"],
                    ["Sep 21", "+1,902", "−431"],
                    ["Sep 20", "+2,650", "−388"],
                    ["Sep 19", "+3,118", "−341"],
                    ["Sep 18", "+4,407", "−296"],
                  ].map(([d, i, o]) => (
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
