"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CHAT_HISTORY_MAX, type CatalogModel, type ChatMessage } from "@dualyne/shared";
import { ChatError, runChat } from "@/lib/chat-client";
import { publicConfig } from "@/lib/config";
import { formatWait } from "@/lib/i18n";
import { md } from "@/lib/markdown";
import { store } from "@/lib/storage";
import { TurnstileRunner } from "@/lib/turnstile";
import { useT } from "./LocaleProvider";
import { ProviderMark } from "./ProviderMark";

interface Turn extends ChatMessage {
  /** The model that wrote an assistant turn. */
  model?: string;
  /** An answer that stopped part-way. */
  failed?: boolean;
}

const CHAT_KEY = "dualyne.chat";
const MODEL_KEY = "dualyne.chat.model";

/**
 * A plain chat with one AI at a time: pick a model, type, press Enter. Free models only; the
 * conversation is kept in this browser (localStorage), never on the server.
 */
export function ChatView({ models }: { models: CatalogModel[] }) {
  const d = useT();
  const t = d.chat;
  const free = models.filter((m) => m.minTier === "explorer" && m.live);
  const [model, setModel] = useState(free[0]?.id ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  /** Saving starts only after the saved chat was read, so it can't overwrite it with []. */
  const [loaded, setLoaded] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tsSlot = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileRunner | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTurns(store.get<Turn[]>(CHAT_KEY, []));
    const saved = store.get<string>(MODEL_KEY, "");
    if (free.some((m) => m.id === saved)) setModel(saved);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on load
  }, []);

  useEffect(() => {
    if (loaded && !busy) store.set(CHAT_KEY, turns);
    // Scroll the conversation box only, never the page.
    const log = logRef.current;
    if (log && turns.length) log.scrollTop = log.scrollHeight;
  }, [turns, busy, loaded]);

  useEffect(() => {
    if (!publicConfig.turnstileSiteKey || !tsSlot.current) return;
    turnstile.current = new TurnstileRunner(publicConfig.turnstileSiteKey, tsSlot.current, "chat");
  }, []);

  const current = models.find((m) => m.id === model);

  const pick = (id: string) => {
    setModel(id);
    store.set(MODEL_KEY, id);
    inputRef.current?.focus();
  };

  const errorText = (e: unknown): string => {
    if (!(e instanceof ChatError)) return t.errors.failed;
    const wait = e.retryAfterSeconds ? formatWait(d, e.retryAfterSeconds) : null;
    switch (e.code) {
      case "rate_limited":
        return t.errors.rateLimited(wait);
      case "budget_exhausted":
        return t.errors.budget;
      case "budget_busy":
        return t.errors.busy;
      case "models_not_live":
        return t.errors.notLive;
      case "turnstile_failed":
      case "turnstile":
        return t.errors.turnstile;
      case "invalid_request":
        return t.errors.long;
      case "network":
        return t.errors.network;
      default:
        return e.message || t.errors.failed;
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !model) return;
    setError("");
    const history: Turn[] = [...turns, { role: "user", content }];
    const ask: ChatMessage[] = history
      .filter((m) => !m.failed)
      .slice(-CHAT_HISTORY_MAX)
      .map(({ role, content }) => ({ role, content }));
    setTurns([...history, { role: "assistant", content: "", model }]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let answer = "";
    const update = (patch: Partial<Turn>) =>
      setTurns((all) => [...all.slice(0, -1), { ...all[all.length - 1]!, ...patch }]);
    try {
      let token: string | undefined;
      if (turnstile.current) {
        try {
          token = await turnstile.current.token();
        } catch {
          throw new ChatError("turnstile", "");
        }
      }
      const result = await runChat(
        publicConfig.apiUrl,
        { model, messages: ask, turnstileToken: token },
        (delta) => {
          answer += delta;
          update({ content: answer });
        },
        ac.signal,
      );
      if (result.remaining !== null) setRemaining(result.remaining);
      if (!result.completed) {
        update({ content: answer, failed: true });
        setError(t.errors.failed);
      }
    } catch (e) {
      if (e instanceof ChatError && e.code === "cancelled") {
        if (answer) update({ content: answer });
        else setTurns((all) => all.slice(0, -1));
      } else {
        // Nothing came back: take the question back into the box so it can be sent again.
        setTurns((all) => all.slice(0, -2));
        setInput(content);
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const reset = () => {
    abort.current?.abort();
    setTurns([]);
    setError("");
    store.set(CHAT_KEY, []);
    inputRef.current?.focus();
  };

  const nameOf = (id?: string) => models.find((m) => m.id === id)?.name ?? "";
  const markOf = (id?: string) => {
    const m = models.find((x) => x.id === id);
    return m ? <ProviderMark provider={m.provider} color={m.providerColor} size={26} /> : null;
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <div>
          <h1 className="grad">{t.title}</h1>
          <p>{t.lede}</p>
        </div>
        {turns.length > 0 && (
          <button className="btn dark sm" type="button" onClick={reset}>
            {t.newChat}
          </button>
        )}
      </div>

      <div className="chat-models" role="radiogroup" aria-label={t.pick}>
        {[...models]
          .sort((a, b) => Number(b.minTier === "explorer") - Number(a.minTier === "explorer"))
          .map((m) => {
            const isFree = m.minTier === "explorer" && m.live;
            const on = m.id === model;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "cm on" : "cm"}
                disabled={!isFree || busy}
                title={isFree ? m.bestFor : `${m.name}: ${t.holdersNote}`}
                onClick={() => pick(m.id)}
              >
                <ProviderMark provider={m.provider} color={m.providerColor} size={22} />
                <span>{m.name}</span>
                <small className={isFree ? "tag free" : "tag"}>{isFree ? t.free : t.holders}</small>
              </button>
            );
          })}
      </div>

      <div className="chat-box">
        <div className="chat-log" aria-live="polite" ref={logRef}>
          {turns.length === 0 ? (
            <div className="chat-empty">
              {current && (
                <ProviderMark provider={current.provider} color={current.providerColor} size={44} />
              )}
              <h2>{t.empty}</h2>
              <div className="chat-sugg">
                {t.suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg-user">
                  <div className="bubble">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="msg-ai">
                  {markOf(m.model)}
                  <div className="ai-body">
                    <div className="ai-name">{nameOf(m.model)}</div>
                    {m.content ? (
                      <div className="lb" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                    ) : (
                      <div className="typing" aria-label="…">
                        <i />
                        <i />
                        <i />
                      </div>
                    )}
                  </div>
                </div>
              ),
            )
          )}
        </div>

        {error && (
          <div className="chat-err" role="alert">
            {error}
          </div>
        )}

        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={8000}
            placeholder={t.placeholder(current?.name ?? "")}
            aria-label={t.placeholder(current?.name ?? "")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
          />
          {busy ? (
            <button className="btn dark" type="button" onClick={() => abort.current?.abort()}>
              {t.stop}
            </button>
          ) : (
            <button className="btn" type="submit" disabled={!input.trim() || !model}>
              {t.send}
            </button>
          )}
        </form>
        <div className="chat-foot">
          <span>{t.hint}</span>
          <span>
            {remaining !== null ? `${t.left(remaining)} · ` : ""}
            {t.local}
          </span>
        </div>
        <div ref={tsSlot} />
      </div>
    </div>
  );
}
