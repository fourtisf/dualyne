"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CatalogModel, Lane, VoteResponse } from "@refract/shared";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { CompareError, runCompare } from "@/lib/compare-client";
import { publicConfig } from "@/lib/config";
import { formatRunCost } from "@/lib/format";
import { apiErrorText, formatWait, type Dict } from "@/lib/i18n";
import { esc, md } from "@/lib/markdown";
import { store } from "@/lib/storage";
import { TurnstileRunner } from "@/lib/turnstile";
import { useT } from "./LocaleProvider";
import { useWallet } from "./WalletProvider";

const SHIMMER =
  '<div class="shim" style="width:82%"></div><div class="shim" style="width:64%"></div><div class="shim" style="width:74%"></div>';

type Status = "idle" | "loading" | "streaming" | "done" | "error";

interface LaneState {
  status: Status;
  text: string;
  error: string | null;
  stats: string[];
}

interface Match {
  a: string;
  b: string;
  w: "a" | "b" | "tie";
  compareId?: string;
}

const exampleLane = (text: string, stats: string[]): LaneState => ({
  status: "done",
  text,
  error: null,
  stats,
});

function statsFor(
  st: Dict["compare"]["stat"],
  o: {
    first: number | null;
    total: number | null;
    tokens: number;
    cost?: number | null;
  },
): string[] {
  const p: string[] = [];
  if (o.first != null) p.push(st.first((o.first / 1000).toFixed(1)));
  if (o.total != null) p.push(st.total((o.total / 1000).toFixed(1)));
  if (o.tokens) p.push(st.tokens(o.tokens));
  if (o.cost != null) p.push(formatRunCost(o.cost));
  return p;
}

function errText(t: Dict, code: string, message: string, retry: number | null, limit: number): string {
  const e = t.compare.errors;
  switch (code) {
    case "cancelled":
      return e.stopped;
    case "rate_limited":
      return e.rateLimited(limit, retry ? formatWait(t, retry) : null);
    case "budget_exhausted":
      return e.budget;
    case "budget_busy":
      return e.busy;
    case "turnstile_failed":
    case "turnstile":
      return e.turnstile;
    case "model_not_allowed":
    case "model_not_found":
      return apiErrorText(t, code, message) || e.modelNotFree;
    case "network":
      return e.network;
    default:
      return e.generic;
  }
}

export function CompareConsole({
  models,
  blindMode = "optional",
}: {
  models: CatalogModel[];
  blindMode?: "optional" | "always";
}) {
  const wallet = useWallet();
  const t = useT();
  const c = t.compare;
  const free = useMemo(() => models.filter((m) => m.minTier === "explorer" && m.live), [models]);
  const keyed = useMemo(() => models.filter((m) => !(m.minTier === "explorer" && m.live)), [models]);
  const liveCount = models.filter((m) => m.live).length;
  const byId = useCallback((id: string) => models.find((m) => m.id === id), [models]);

  const [prompt, setPrompt] = useState(c.exPrompt);
  const [placeholder, setPlaceholder] = useState(c.placeholder);
  const [modelA, setModelA] = useState(free[0]?.id ?? "claude-swift");
  const [modelB, setModelB] = useState(
    free.find((m) => m.id === "llama")?.id ?? free[1]?.id ?? free[0]?.id ?? "llama",
  );
  const [lanes, setLanes] = useState<Record<Lane, LaneState>>({
    a: exampleLane(c.exA, [c.stat.first("0.4"), c.stat.total("1.9"), c.stat.tokens(96)]),
    b: exampleLane(c.exB, [c.stat.first("1.1"), c.stat.total("5.2"), c.stat.tokens(168)]),
  });
  const [busy, setBusy] = useState(false);
  const [example, setExample] = useState(true);
  const [verdictShown, setVerdictShown] = useState(false);
  const [vote, setVote] = useState<Match["w"] | null>(null);
  const [kmod, setKmod] = useState("Ctrl");
  const [announce, setAnnounce] = useState("");
  const [votes, setVotes] = useState(0);
  const [copied, setCopied] = useState<Lane | null>(null);
  const [blindPref, setBlindPref] = useState(false);
  const blind = blindMode === "always" || blindPref;
  /** Set while the shown answers come from a blind run; `revealed` holds the models after voting. */
  const [blindRun, setBlindRun] = useState<{ revealed: { a: string; b: string } | null } | null>(null);
  const [voteNote, setVoteNote] = useState("");
  const [share, setShare] = useState<"share" | "sharing" | "linkCopied" | "linkOpened">("share");

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const tsSlot = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileRunner | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const runRef = useRef<{
    pair: [string, string] | null;
    compareId: string | null;
    matchIdx: number | null;
    blind: boolean;
  } | null>(null);

  // A model page links here with ?a=<id> to preselect that model on the left.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("a");
    if (!want || blindMode === "always" || !free.some((m) => m.id === want)) return;
    setModelA(want);
    if (modelB === want) setModelB(free.find((m) => m.id !== want)?.id ?? want);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setKmod("⌘");
    setVotes(store.get<Match[]>("refract.matches", []).length);
  }, []);

  useEffect(() => {
    if (!publicConfig.turnstileSiteKey || !tsSlot.current) return;
    turnstile.current = new TurnstileRunner(publicConfig.turnstileSiteKey, tsSlot.current);
  }, []);

  const patch = (L: Lane, p: Partial<LaneState>) => setLanes((s) => ({ ...s, [L]: { ...s[L], ...p } }));

  const run = async () => {
    const text = prompt.trim();
    if (!text) {
      setPlaceholder(c.placeholderEmpty);
      promptRef.current?.focus();
      return;
    }
    if (busy) return;

    const ac = new AbortController();
    ctrl.current = ac;
    runRef.current = { pair: blind ? null : [modelA, modelB], compareId: null, matchIdx: null, blind };
    setBlindRun(blind ? { revealed: null } : null);
    setVoteNote("");
    setShare("share");
    setBusy(true);
    setExample(false);
    setVerdictShown(false);
    setVote(null);
    setLanes({
      a: { status: "loading", text: "", error: null, stats: [] },
      b: { status: "loading", text: "", error: null, stats: [] },
    });
    setAnnounce(c.announce.started);

    const t0 = performance.now();
    const acc: Record<Lane, { text: string; first: number | null; ok: boolean; ended: boolean }> = {
      a: { text: "", first: null, ok: false, ended: false },
      b: { text: "", first: null, ok: false, ended: false },
    };
    const failLanes = (msg: string) => {
      for (const L of ["a", "b"] as const) {
        if (acc[L].ended) continue;
        acc[L].ended = true;
        const now = performance.now() - t0;
        setLanes((s) => ({
          ...s,
          [L]: {
            status: "error",
            text: acc[L].text,
            error: msg,
            stats: acc[L].text
              ? statsFor(c.stat, {
                  first: acc[L].first,
                  total: now,
                  tokens: Math.round(acc[L].text.length / 4),
                })
              : [],
          },
        }));
      }
    };

    try {
      let token: string | undefined;
      if (turnstile.current) {
        try {
          token = await turnstile.current.token();
        } catch {
          throw new CompareError(ac.signal.aborted ? "cancelled" : "turnstile", "");
        }
      }
      if (ac.signal.aborted) throw new CompareError("cancelled", "");

      const result = await runCompare(
        publicConfig.apiUrl,
        blind
          ? { prompt: text, blind: true, turnstileToken: token }
          : { prompt: text, a: modelA, b: modelB, turnstileToken: token },
        {
          onMeta: (m) => {
            if (runRef.current) runRef.current.compareId = m.compareId;
            wallet.recordRun();
          },
          onDelta: (L, chunk) => {
            if (acc[L].first == null) acc[L].first = performance.now() - t0;
            acc[L].text += chunk;
            const snapshot = acc[L].text;
            const first = acc[L].first;
            setLanes((s) => ({
              ...s,
              [L]: {
                status: "streaming",
                text: snapshot,
                error: null,
                stats: statsFor(c.stat, { first, total: null, tokens: Math.round(snapshot.length / 4) }),
              },
            }));
          },
          onDone: (d) => {
            const L = d.lane;
            acc[L].ok = true;
            acc[L].ended = true;
            const total = performance.now() - t0;
            patch(L, {
              status: "done",
              text: acc[L].text,
              stats: statsFor(c.stat, {
                first: acc[L].first,
                total,
                tokens: d.outputTokens,
                cost: d.costUsd,
              }),
            });
            setAnnounce(c.announce.finished(L === "a"));
          },
          onLaneError: (L, code) => {
            if (acc[L].ended) return;
            acc[L].ended = true;
            const total = performance.now() - t0;
            patch(L, {
              status: "error",
              text: acc[L].text,
              error: errText(t, code, "", null, wallet.compareLimit),
              stats: statsFor(c.stat, {
                first: acc[L].first,
                total,
                tokens: Math.round(acc[L].text.length / 4),
              }),
            });
            setAnnounce(c.announce.failed(L === "a"));
          },
        },
        ac.signal,
      );
      if (result.remaining !== null) wallet.setCompareRemaining(result.remaining);
    } catch (e) {
      const err = e instanceof CompareError ? e : new CompareError("unknown", "");
      if (err.code === "rate_limited") wallet.setCompareRemaining(0);
      const msg = errText(t, err.code, err.message, err.retryAfterSeconds, wallet.compareLimit);
      failLanes(msg);
      setAnnounce(msg);
    } finally {
      ctrl.current = null;
      setBusy(false);
    }

    if (acc.a.ok && acc.b.ok) {
      setVerdictShown(true);
      setAnnounce(c.announce.both);
    }
  };

  const saveLocalVote = (pair: [string, string], w: Match["w"], compareId: string | null) => {
    const r = runRef.current;
    if (!r) return;
    const ms = store.get<Match[]>("refract.matches", []);
    if (r.matchIdx == null) {
      ms.push({ a: pair[0], b: pair[1], w, ...(compareId ? { compareId } : {}) });
      r.matchIdx = ms.length - 1;
    } else if (ms[r.matchIdx]) {
      ms[r.matchIdx]!.w = w;
    }
    store.set("refract.matches", ms);
    setVotes(ms.length);
    wallet.bump();
  };

  const castVote = async (w: Match["w"]) => {
    const r = runRef.current;
    if (!r) return;
    setVote(w);
    if (r.pair) saveLocalVote(r.pair, w, r.compareId);
    if (!r.compareId) return;
    try {
      const res = await apiFetch<VoteResponse>("/votes", {
        method: "POST",
        body: { compareId: r.compareId, winner: w },
      });
      if (r.blind) {
        r.pair = [res.a, res.b];
        setBlindRun({ revealed: { a: res.a, b: res.b } });
        saveLocalVote(r.pair, w, r.compareId);
      }
      setVoteNote(res.counted ? c.voteCounted : c.voteNotRanked);
    } catch (e) {
      setVoteNote(e instanceof ApiRequestError ? apiErrorText(t, e.code, e.message) : c.voteFailed);
    }
  };

  const shareRun = async () => {
    const r = runRef.current;
    if (!r?.compareId) return;
    setShare("sharing");
    try {
      const res = await fetch(`${publicConfig.apiUrl}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ compareId: r.compareId }),
      });
      const json = (await res.json()) as {
        id?: string;
        token?: string | null;
        error?: { code: string; message: string };
      };
      if (!res.ok || !json.id) {
        throw new Error(json.error ? apiErrorText(t, json.error.code, json.error.message) : "");
      }
      if (json.token) {
        const all = store.get<Record<string, string>>("refract.shares", {});
        all[json.id] = json.token;
        store.set("refract.shares", all);
      }
      const url = `${window.location.origin}/s/${json.id}`;
      try {
        await navigator.clipboard.writeText(url);
        setShare("linkCopied");
      } catch {
        window.open(url, "_blank", "noopener");
        setShare("linkOpened");
      }
    } catch (e) {
      setShare("share");
      setVoteNote(e instanceof Error && e.message ? e.message : c.shareFailed);
    }
  };

  const copyLane = async (L: Lane) => {
    try {
      await navigator.clipboard.writeText(lanes[L].text);
      setCopied(L);
      setTimeout(() => setCopied((c) => (c === L ? null : c)), 1600);
    } catch {
      /* clipboard blocked: the text can still be selected by hand */
    }
  };

  const laneHtml = (s: LaneState): string => {
    if (s.status === "loading") return SHIMMER;
    let html = s.text ? md(s.text) : "";
    if (s.status === "streaming") html += '<span class="caret"></span>';
    if (s.error) html += `<p class="err">${esc(s.error)}</p>`;
    return html;
  };

  const remainingLeft = wallet.compareLimit - wallet.compareUsed;
  const record = [
    voteNote || (votes ? c.votesInRanking(votes) : ""),
    wallet.compareUsed > 0 && remainingLeft <= 3 ? c.runsLeft(remainingLeft) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const select = (id: string, value: string, onChange: (v: string) => void, label: string) => (
    <>
      <label className="sr" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={busy}>
        <optgroup label={c.groupFree}>
          {free.map((m) => (
            <option key={m.id} value={m.id}>
              {m.menuName}
            </option>
          ))}
        </optgroup>
        {keyed.length > 0 && (
          <optgroup label={c.groupKey}>
            {keyed.map((m) => (
              <option key={m.id} value={m.id} disabled>
                {m.menuName}
                {m.live ? "" : c.unavailable}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </>
  );

  const lane = (L: Lane) => {
    const s = lanes[L];
    const html = laneHtml(s);
    const canCopy = (s.status === "done" || s.status === "error") && s.text.length > 0 && !example;
    return (
      <div className="lane" data-lane={L}>
        <div className="lh">
          <span className="sw" />
          {blindRun ? (
            <span className="blind-name">
              {blindRun.revealed ? (
                <>
                  {byId(blindRun.revealed[L])?.menuName ?? blindRun.revealed[L]} <small>{c.revealed}</small>
                </>
              ) : (
                <>
                  {c.hiddenModel(L.toUpperCase())} <small>{c.hiddenNote}</small>
                </>
              )}
            </span>
          ) : L === "a" ? (
            select("modelA", modelA, setModelA, c.leftModel)
          ) : (
            select("modelB", modelB, setModelB, c.rightModel)
          )}
          <div className="stats" id={L === "a" ? "statsA" : "statsB"}>
            {s.stats.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        </div>
        <div
          className="lb"
          id={L === "a" ? "outA" : "outB"}
          aria-busy={s.status === "loading" || s.status === "streaming"}
          aria-label={c.answerAria(L === "a", byId(L === "a" ? modelA : modelB)?.menuName ?? null)}
          role="region"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {canCopy && (
          <button
            className="lcopy"
            type="button"
            onClick={() => copyLane(L)}
            aria-label={c.copyAria(L === "a")}
          >
            {copied === L ? t.copy.copied : t.copy.copy}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="stage rise" id="compare" style={{ "--d": ".5s" } as CSSProperties}>
      <div className="console">
        <div className="bar">
          <span className="t">{c.title}</span>
          <span className="sub">{c.sub}</span>
          <span className="tag" id="exTag" hidden={!example}>
            {c.example}
          </span>
          <span className="live">
            <i />
            {c.live(liveCount)}
          </span>
        </div>
        <div className="composer">
          <label htmlFor="prompt" className="sr">
            {c.promptLabel}
          </label>
          <textarea
            id="prompt"
            ref={promptRef}
            placeholder={placeholder}
            value={prompt}
            maxLength={8000}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void run();
              }
            }}
          />
          <div className="cbar">
            {c.chips.map((chip) => (
              <button
                key={chip.label}
                className="chip"
                type="button"
                onClick={() => {
                  setPrompt(chip.prompt);
                  promptRef.current?.focus();
                }}
              >
                {chip.label}
              </button>
            ))}
            <span className="sp" />
            {blindMode === "always" ? (
              <span className="chip blind-toggle" aria-disabled="true" title={c.blindAlways}>
                {c.blind}
              </span>
            ) : (
              <button
                className="chip blind-toggle"
                type="button"
                aria-pressed={blind}
                disabled={busy}
                title={c.blindTitle}
                onClick={() => {
                  setBlindPref((b) => !b);
                  if (!busy) setBlindRun(null);
                }}
              >
                {c.blind}
              </button>
            )}
            <span className="hint">
              <kbd id="kmod">{kmod}</kbd>
              <kbd>↵</kbd>
            </span>
            <button
              className="btn dark sm"
              id="stopBtn"
              type="button"
              hidden={!busy}
              onClick={() => ctrl.current?.abort()}
            >
              {c.stop}
            </button>
            <button className="btn sm" id="runBtn" type="button" disabled={busy} onClick={() => void run()}>
              {busy ? c.running : c.run}
            </button>
          </div>
          <div className="ts-slot" ref={tsSlot} />
        </div>
        <div className="lanes">
          {lane("a")}
          {lane("b")}
        </div>
        <div className={verdictShown ? "verdict show" : "verdict"} id="verdict">
          <span className="q">{c.verdictQ}</span>
          {(
            [
              ["a", c.left],
              ["tie", c.tie],
              ["b", c.right],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className="chip"
              type="button"
              aria-pressed={vote === v}
              onClick={() => castVote(v)}
            >
              {label}
            </button>
          ))}
          <button
            className="chip"
            type="button"
            onClick={() => void shareRun()}
            disabled={Boolean(blindRun && !blindRun.revealed) || share === "sharing"}
            title={blindRun && !blindRun.revealed ? c.shareVoteFirst : c.shareTitle}
          >
            {c[share]}
          </button>
          <span className="record" id="record">
            {record}
          </span>
        </div>
        <p className="sr" aria-live="polite">
          {announce}
        </p>
      </div>
    </div>
  );
}
