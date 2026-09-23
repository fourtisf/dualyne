"use client";

import { useEffect, useState } from "react";
import { brand } from "@refract/config";
import { shortAddr } from "@/lib/format";
import { store } from "@/lib/storage";
import { useWallet } from "./WalletProvider";

interface Day {
  k: string;
  lab: string;
  n: number;
}

/** Last 7 days of comparisons from this browser (stored locally, like the prototype). */
function lastWeek(): Day[] {
  const hist = store.get<Record<string, number>>("refract.hist", {});
  const days: Day[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const k = d.toISOString().slice(0, 10);
    days.push({ k, lab: d.toLocaleDateString("en-US", { weekday: "short" }), n: hist[k] ?? 0 });
  }
  return days;
}

export function DashboardView() {
  const w = useWallet();
  const [mounted, setMounted] = useState(false);
  const [days, setDays] = useState<Day[]>([]);

  useEffect(() => {
    setMounted(true);
    setDays(lastWeek());
  }, [w.version]);

  if (!mounted)
    return (
      <div className="dash-head">
        <h1 className="grad">Dashboard</h1>
      </div>
    );

  if (!w.addr) {
    return (
      <>
        <div className="dash-head">
          <h1 className="grad">Dashboard</h1>
        </div>
        <div className="gate">
          <h2>Connect a wallet to see your usage</h2>
          <p>Your wallet is your account. Connecting takes one click and no gas.</p>
          <button className="btn lg" type="button" id="dashConnect" onClick={w.openModal}>
            Connect wallet
          </button>
        </div>
      </>
    );
  }

  const max = Math.max(1, ...days.map((d) => d.n));
  const week = days.reduce((a, d) => a + d.n, 0);
  const used = w.compareUsed;

  return (
    <>
      <div className="dash-head">
        <div>
          <div className="kick">
            <i />
            {shortAddr(w.addr)}
          </div>
          <h1 className="grad">Dashboard</h1>
        </div>
        <span className="sp" />
        <button className="btn dark" type="button" id="dKeys" onClick={w.openModal}>
          Manage keys
        </button>
        <button className="btn" type="button" disabled title="Available when the Builder tier launches">
          Top up credits
        </button>
      </div>
      <div className="dgrid">
        <div className="card">
          <div className="l">Free comparisons this hour</div>
          <div className="v">
            {used}{" "}
            <span style={{ fontSize: 16, color: "var(--muted)", letterSpacing: 0 }}>of {w.compareLimit}</span>
          </div>
          <div className="meter">
            <i style={{ width: `${Math.min(100, (used / w.compareLimit) * 100)}%` }} />
          </div>
        </div>
        <div className="card">
          <div className="l">Current tier</div>
          <div className="v">Explorer</div>
          <div className="s">Hold 100,000 {brand.tokenSymbol} to unlock Holder</div>
        </div>
        <div className="card">
          <div className="l">Active keys</div>
          <div className="v">0</div>
          <div className="s">Self-serve keys open with wallet sign-in</div>
        </div>
        <div className="card span3">
          <div className="l" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Comparisons from this browser, last 7 days</span>
            <span>{week} total</span>
          </div>
          <div className="bars">
            {days.map((d) => (
              <div key={d.k}>
                <i style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }} title={`${d.n} comparisons`} />
                <span>{d.lab}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
