"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CatalogModel, Lane } from "@refract/shared";
import { CompareError, runCompare } from "@/lib/compare-client";
import { publicConfig } from "@/lib/config";
import { formatRunCost, formatWait } from "@/lib/format";
import { esc, md } from "@/lib/markdown";
import { store } from "@/lib/storage";
import { TurnstileRunner } from "@/lib/turnstile";
import { useWallet } from "./WalletProvider";

/* Example run so the console never looks empty (from the prototype). */
const EX_PROMPT =
  "Explain how an automated market maker sets a token's price, in five sentences a beginner can follow.";
const EX_A =
  "An AMM is a pool holding two tokens, say ETH and USDC.\n\nThe price is simply the **ratio** between them: if the pool holds 10 ETH and 30,000 USDC, one ETH costs about 3,000 USDC.\n\nWhen you buy ETH, you add USDC and remove ETH, so ETH becomes scarcer in the pool and its price rises.\n\nThe pool keeps `x × y = k` constant, which is why big trades move the price more.\n\nArbitrage traders keep this price in line with other markets.";
const EX_B =
  "### The short version\nAn automated market maker replaces the order book with a **pool of two tokens** and a formula.\n\n1. The pool holds reserves of both tokens, for example ETH and USDC.\n2. The price is the ratio of those reserves, not a match between buyers and sellers.\n3. Every trade changes the reserves, so every trade changes the price.\n4. The rule `x × y = k` keeps the product of reserves fixed, which makes larger trades cost more per unit (slippage).\n5. When the pool drifts from the wider market, arbitrageurs trade it back and pocket the gap.\n\nThe result: prices update continuously, with no one quoting them.";

const CHIPS = [
  {
    label: "Explain an AMM",
    prompt:
      "Explain how an automated market maker sets a token's price, in five sentences a beginner can follow.",
  },
  {
    label: "Draft launch tweets",
    prompt:
      "Write three short launch tweets for a new AI tool that lets people compare model answers side by side. Keep each under 200 characters.",
  },
  {
    label: "Review token risks",
    prompt:
      "What are the three most common security mistakes in ERC-20 token contracts, and how do you avoid each one?",
  },
];

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

function statsFor(o: {
  first: number | null;
  total: number | null;
  tokens: number;
  cost?: number | null;
}): string[] {
  const p: string[] = [];
  if (o.first != null) p.push(`${(o.first / 1000).toFixed(1)}s first`);
  if (o.total != null) p.push(`${(o.total / 1000).toFixed(1)}s total`);
  if (o.tokens) p.push(`~${o.tokens} tok`);
  if (o.cost != null) p.push(formatRunCost(o.cost));
  return p;
}

function errText(code: string, message: string, retry: number | null, limit: number): string {
  switch (code) {
    case "cancelled":
      return "Stopped.";
    case "rate_limited":
      return `You've used your ${limit} free comparisons for this hour.${retry ? ` Try again in ${formatWait(retry)}.` : ""}`;
    case "budget_exhausted":
      return "Free comparisons are paused for today. They come back at 00:00 UTC.";
    case "turnstile_failed":
    case "turnstile":
      return "We couldn't verify this browser. Reload the page and try again.";
    case "model_not_allowed":
    case "model_not_found":
      return message || "That model isn't available for free comparisons.";
    case "network":
      return "Couldn't reach the server. Check your connection, then run again.";
    default:
      return "The model didn't finish this answer. Run the comparison again.";
  }
}

export function CompareConsole({ models }: { models: CatalogModel[] }) {
  const wallet = useWallet();
  const free = useMemo(() => models.filter((m) => m.minTier === "explorer" && m.live), [models]);
  const keyed = useMemo(() => models.filter((m) => !(m.minTier === "explorer" && m.live)), [models]);
  const liveCount = models.filter((m) => m.live).length;
  const byId = useCallback((id: string) => models.find((m) => m.id === id), [models]);

  const [prompt, setPrompt] = useState(EX_PROMPT);
  const [placeholder, setPlaceholder] = useState("Ask anything. Both models get the exact same words.");
  const [modelA, setModelA] = useState(free[0]?.id ?? "claude-swift");
  const [modelB, setModelB] = useState(
    free.find((m) => m.id === "llama")?.id ?? free[1]?.id ?? free[0]?.id ?? "llama",
  );
  const [lanes, setLanes] = useState<Record<Lane, LaneState>>({
    a: exampleLane(EX_A, ["0.4s first", "1.9s total", "~96 tok"]),
    b: exampleLane(EX_B, ["1.1s first", "5.2s total", "~168 tok"]),
  });
  const [busy, setBusy] = useState(false);
  const [example, setExample] = useState(true);
  const [verdictShown, setVerdictShown] = useState(false);
  const [vote, setVote] = useState<Match["w"] | null>(null);
  const [kmod, setKmod] = useState("Ctrl");
  const [announce, setAnnounce] = useState("");
  const [votes, setVotes] = useState(0);
  const [copied, setCopied] = useState<Lane | null>(null);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const tsSlot = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileRunner | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const runRef = useRef<{ pair: [string, string]; compareId: string | null; matchIdx: number | null } | null>(
    null,
  );

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
      setPlaceholder("Type a prompt first, or pick one of the examples below.");
      promptRef.current?.focus();
      return;
    }
    if (busy) return;

    const ac = new AbortController();
    ctrl.current = ac;
    runRef.current = { pair: [modelA, modelB], compareId: null, matchIdx: null };
    setBusy(true);
    setExample(false);
    setVerdictShown(false);
    setVote(null);
    setLanes({
      a: { status: "loading", text: "", error: null, stats: [] },
      b: { status: "loading", text: "", error: null, stats: [] },
    });
    setAnnounce("Comparison started.");

    const t0 = performance.now();
    const acc: Record<Lane, { text: string; first: number | null; ok: boolean; ended: boolean }> = {
      a: { text: "", first: null, ok: false, ended: false },
      b: { text: "", first: null, ok: false, ended: false },
    };
    const side = (L: Lane) => (L === "a" ? "Left" : "Right");
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
              ? statsFor({ first: acc[L].first, total: now, tokens: Math.round(acc[L].text.length / 4) })
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
        { prompt: text, a: modelA, b: modelB, turnstileToken: token },
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
                stats: statsFor({ first, total: null, tokens: Math.round(snapshot.length / 4) }),
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
              stats: statsFor({ first: acc[L].first, total, tokens: d.outputTokens, cost: d.costUsd }),
            });
            setAnnounce(`${side(L)} answer finished.`);
          },
          onLaneError: (L, code) => {
            if (acc[L].ended) return;
            acc[L].ended = true;
            const total = performance.now() - t0;
            patch(L, {
              status: "error",
              text: acc[L].text,
              error: errText(code, "", null, wallet.compareLimit),
              stats: statsFor({ first: acc[L].first, total, tokens: Math.round(acc[L].text.length / 4) }),
            });
            setAnnounce(`${side(L)} answer failed.`);
          },
        },
        ac.signal,
      );
      if (result.remaining !== null) wallet.setCompareRemaining(result.remaining);
    } catch (e) {
      const err = e instanceof CompareError ? e : new CompareError("unknown", "");
      if (err.code === "rate_limited") wallet.setCompareRemaining(0);
      const msg = errText(err.code, err.message, err.retryAfterSeconds, wallet.compareLimit);
      failLanes(msg);
      setAnnounce(msg);
    } finally {
      ctrl.current = null;
      setBusy(false);
    }

    if (acc.a.ok && acc.b.ok) {
      setVerdictShown(true);
      setAnnounce("Both answers finished. Which answer was better?");
    }
  };

  const castVote = (w: Match["w"]) => {
    const r = runRef.current;
    if (!r) return;
    setVote(w);
    const ms = store.get<Match[]>("refract.matches", []);
    if (r.matchIdx == null) {
      ms.push({ a: r.pair[0], b: r.pair[1], w, ...(r.compareId ? { compareId: r.compareId } : {}) });
      r.matchIdx = ms.length - 1;
    } else if (ms[r.matchIdx]) {
      ms[r.matchIdx]!.w = w;
    }
    store.set("refract.matches", ms);
    setVotes(ms.length);
    wallet.bump();
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
    votes ? `${votes} vote${votes > 1 ? "s" : ""} counted on the leaderboard` : "",
    wallet.compareUsed > 0 && remainingLeft <= 3
      ? `${remainingLeft} free comparison${remainingLeft === 1 ? "" : "s"} left this hour`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const select = (id: string, value: string, onChange: (v: string) => void, label: string) => (
    <>
      <label className="sr" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={busy}>
        <optgroup label="Free to compare">
          {free.map((m) => (
            <option key={m.id} value={m.id}>
              {m.menuName}
            </option>
          ))}
        </optgroup>
        {keyed.length > 0 && (
          <optgroup label="With an API key">
            {keyed.map((m) => (
              <option key={m.id} value={m.id} disabled>
                {m.menuName}
                {m.live ? "" : " (unavailable)"}
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
          {L === "a"
            ? select("modelA", modelA, setModelA, "Left model")
            : select("modelB", modelB, setModelB, "Right model")}
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
          aria-label={`${L === "a" ? "Left" : "Right"} answer${byId(L === "a" ? modelA : modelB) ? `, ${byId(L === "a" ? modelA : modelB)!.menuName}` : ""}`}
          role="region"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {canCopy && (
          <button
            className="lcopy"
            type="button"
            onClick={() => copyLane(L)}
            aria-label={`Copy the ${L === "a" ? "left" : "right"} answer`}
          >
            {copied === L ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="stage rise" id="compare" style={{ "--d": ".5s" } as CSSProperties}>
      <div className="console">
        <div className="bar">
          <span className="t">Compare</span>
          <span className="sub">Two models, one prompt</span>
          <span className="tag" id="exTag" hidden={!example}>
            Example run
          </span>
          <span className="live">
            <i />
            {liveCount} models live
          </span>
        </div>
        <div className="composer">
          <label htmlFor="prompt" className="sr">
            Your prompt
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
            {CHIPS.map((c) => (
              <button
                key={c.label}
                className="chip"
                type="button"
                onClick={() => {
                  setPrompt(c.prompt);
                  promptRef.current?.focus();
                }}
              >
                {c.label}
              </button>
            ))}
            <span className="sp" />
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
              Stop
            </button>
            <button className="btn sm" id="runBtn" type="button" disabled={busy} onClick={() => void run()}>
              {busy ? "Running…" : "Run comparison"}
            </button>
          </div>
          <div className="ts-slot" ref={tsSlot} />
        </div>
        <div className="lanes">
          {lane("a")}
          {lane("b")}
        </div>
        <div className={verdictShown ? "verdict show" : "verdict"} id="verdict">
          <span className="q">Which answer was better?</span>
          {(
            [
              ["a", "Left"],
              ["tie", "About the same"],
              ["b", "Right"],
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
