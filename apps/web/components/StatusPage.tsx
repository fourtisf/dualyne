import type { StatusResponse } from "@dualyne/shared";
import { getDict, href, type Locale } from "@/lib/i18n";
import { AutoRefresh } from "./AutoRefresh";

const hhmm = (iso: string) => iso.slice(11, 16);
const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const pill = (state: string) =>
  state === "operational"
    ? "st live"
    : state === "degraded"
      ? "st warn"
      : state === "down"
        ? "st off"
        : "st api";

/** Public status: services, free comparisons and each model's last hour. */
export function StatusPage({ locale, status: s }: { locale: Locale; status: StatusResponse | null }) {
  const d = getDict(locale);
  const t = d.statusPage;
  const overall = s?.status ?? "down";
  return (
    <main className="view">
      <AutoRefresh seconds={30} />
      <div className="wrap sp">
        <div className="head">
          <div className="kick">
            <i />
            {t.title}
          </div>
          <h1 className={`sp-h sp-${overall}`}>
            <span className="sp-dot" aria-hidden="true" />
            {t.headline[overall]}
          </h1>
          <p>{s ? t.checked(hhmm(s.checkedAt)) : t.unreachable}</p>
        </div>

        {s && (
          <>
            <h2 className="sp-sub">{t.services}</h2>
            <div className="dgrid sp-svc">
              {(["api", "database", "cache"] as const).map((k) => (
                <div className="card" key={k}>
                  <div className="l">{t.svc[k]}</div>
                  <span className={s.services[k] === "ok" ? "st live" : "st off"}>
                    {s.services[k] === "ok" ? t.ok : t.down}
                  </span>
                </div>
              ))}
              <div className="card">
                <div className="l">{t.svc.compare}</div>
                <span className={s.freeCompare.state === "available" ? "st live" : "st warn"}>
                  {s.freeCompare.state === "available"
                    ? t.available
                    : t.paused(hhmm(s.freeCompare.resumesAt ?? s.checkedAt))}
                </span>
                {s.freeCompare.state === "paused" && <div className="s">{t.pausedNote}</div>}
              </div>
            </div>

            <h2 className="sp-sub">{t.models}</h2>
            <div className="tbl sp-tbl" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>{t.th.model}</th>
                    <th>{t.th.state}</th>
                    <th className="num">{t.th.calls}</th>
                    <th className="num">{t.th.errors}</th>
                    <th className="num">{t.th.ttft}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.models.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <a className="mname" href={href(locale, `/models/${m.id}`)}>
                          {m.name}
                        </a>
                      </td>
                      <td>
                        <span className={pill(m.state)}>{t.state[m.state]}</span>
                      </td>
                      <td className="num">{m.requests.toLocaleString("en-US")}</td>
                      <td className="num">
                        {m.errorRate === null ? "—" : `${Math.round(m.errorRate * 1000) / 10}%`}
                      </td>
                      <td className="num">{m.ttftMs === null ? "—" : `${(m.ttftMs / 1000).toFixed(2)} s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine sp-jobs">
              {t.jobsVerified(s.jobs.modelsVerifiedAt ? stamp(s.jobs.modelsVerifiedAt) : t.never)}{" "}
              {t.jobsSynced(s.jobs.treasurySyncedAt ? stamp(s.jobs.treasurySyncedAt) : t.never)}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
