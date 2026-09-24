"use client";

import { brand } from "@dualyne/config";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CHAT_HISTORY_MAX, CHAT_MESSAGE_MAX, type CatalogModel, type ChatMessage } from "@dualyne/shared";
import { ChatError, getChatQuota, runChat, shareChat } from "@/lib/chat-client";
import { publicConfig } from "@/lib/config";
import { formatWait } from "@/lib/i18n";
import { md } from "@/lib/markdown";
import { store } from "@/lib/storage";
import { TurnstileRunner } from "@/lib/turnstile";
import { useCopy } from "@/lib/useCopy";
import { useT } from "./LocaleProvider";
import { ProviderMark } from "./ProviderMark";

interface Turn extends ChatMessage {
  /** The model that wrote an assistant turn. */
  model?: string;
  /** An answer that stopped part-way. */
  failed?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  turns: Turn[];
  updatedAt: number;
}

const CHATS_KEY = "dualyne.chats";
const ACTIVE_KEY = "dualyne.chats.active";
const MODEL_KEY = "dualyne.chat.model";
/** chat id → the link it was shared as (and how many messages it held then). */
const SHARE_OF_KEY = "dualyne.chatShareOf";
/** share id → delete token; only this browser can remove the link. */
const SHARE_TOKENS_KEY = "dualyne.chatShares";
/** The single conversation the first version of this page kept. */
const OLD_KEY = "dualyne.chat";
const MAX_CHATS = 30;
const NO_TURNS: Turn[] = [];
const TITLE_MAX = 48;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const titleOf = (text: string) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
};

/**
 * Chat with one AI at a time, like a regular chat app: past chats on the left, a model picker on
 * top, the conversation in the middle and the message box pinned to the bottom. Free models
 * only. Chats are kept in this browser (localStorage), never on the server.
 */
export function ChatView({ models }: { models: CatalogModel[] }) {
  const d = useT();
  const t = d.chat;
  const free = models.filter((m) => m.minTier === "explorer" && m.live);
  const premium = models.filter((m) => !(m.minTier === "explorer" && m.live));

  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState(free[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<{ limit: number; remaining: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  /** Saving starts only after saved chats were read, so it can't overwrite them. */
  const [loaded, setLoaded] = useState(false);
  /** A question typed on the home page (/chat?q=…&m=…), asked once the chat has loaded. */
  const [autoAsk, setAutoAsk] = useState<string | null>(null);
  /** The public link of the open chat after Share, and whether it reached the clipboard. */
  const [shared, setShared] = useState<{ chatId: string; url: string; copied: boolean } | null>(null);
  const [sharing, setSharing] = useState(false);

  const abort = useRef<AbortController | null>(null);
  const tsSlot = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileRunner | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const turns = active?.turns ?? NO_TURNS;
  const current = models.find((m) => m.id === model);

  // Load saved chats (moving the first version's single chat over) and the free quota.
  useEffect(() => {
    let saved = store.get<Conversation[]>(CHATS_KEY, []);
    const old = store.get<Turn[]>(OLD_KEY, []);
    if (old.length) {
      if (!saved.length) {
        const first = old.find((m) => m.role === "user");
        saved = [
          { id: newId(), title: titleOf(first?.content ?? t.newChat), turns: old, updatedAt: Date.now() },
        ];
        // Save the moved chat before clearing the old key, so nothing is lost if this runs twice.
        store.set(CHATS_KEY, saved);
      }
      store.set(OLD_KEY, []);
    }
    setChats(saved);
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") ?? "").trim().slice(0, CHAT_MESSAGE_MAX);
    const last = store.get<string | null>(ACTIVE_KEY, null);
    // A question from the home page starts a new chat.
    setActiveId(!q && saved.some((c) => c.id === last) ? last : null);
    const m = params.get("m") || store.get<string>(MODEL_KEY, "");
    if (free.some((x) => x.id === m)) setModel(m);
    if (q) {
      setAutoAsk(q);
      // Drop the question from the address, so a reload doesn't ask it again.
      window.history.replaceState(null, "", window.location.pathname);
    }
    setLoaded(true);
    void getChatQuota(publicConfig.apiUrl).then((q) => q && setQuota(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on load
  }, []);

  useEffect(() => {
    if (!loaded || busy) return;
    store.set(CHATS_KEY, chats);
    store.set(ACTIVE_KEY, activeId);
  }, [chats, activeId, busy, loaded]);

  // Keep the newest message in view, scrolling the conversation only (never the page).
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  useEffect(() => {
    if (!publicConfig.turnstileSiteKey || !tsSlot.current) return;
    turnstile.current = new TurnstileRunner(publicConfig.turnstileSiteKey, tsSlot.current, "chat");
  }, []);

  // Grow the message box with its text, up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

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

  /** Replace one conversation's turns (and mark it as the most recent). */
  const setTurnsOf = (id: string, update: (turns: Turn[]) => Turn[]) =>
    setChats((all) =>
      all.map((c) => (c.id === id ? { ...c, turns: update(c.turns), updatedAt: Date.now() } : c)),
    );

  /**
   * Ask the model to answer `history` (which ends with the visitor's message) in conversation
   * `id`. `fresh` means that message was just typed: if nothing comes back it goes back into the box.
   */
  const run = async (id: string, history: Turn[], fresh: boolean) => {
    setError("");
    const ask: ChatMessage[] = history
      .filter((m) => !m.failed && m.content)
      .slice(-CHAT_HISTORY_MAX)
      .map(({ role, content }) => ({ role, content }));
    setTurnsOf(id, () => [...history, { role: "assistant", content: "", model }]);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let answer = "";
    const setAnswer = (patch: Partial<Turn>) =>
      setTurnsOf(id, (all) => [...all.slice(0, -1), { ...all[all.length - 1]!, ...patch }]);
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
          setAnswer({ content: answer });
        },
        ac.signal,
      );
      if (result.remaining !== null) {
        const left = result.remaining;
        setQuota((q) => (q ? { ...q, remaining: left } : q));
      }
      if (!result.completed) {
        setAnswer({ content: answer, failed: true });
        setError(t.errors.failed);
      }
    } catch (e) {
      if (e instanceof ChatError && e.code === "cancelled") {
        if (answer) setAnswer({ content: answer });
        else setTurnsOf(id, (all) => all.slice(0, -1));
      } else {
        setTurnsOf(id, (all) => all.slice(0, fresh ? -2 : -1));
        if (fresh) setInput(history[history.length - 1]!.content);
        setError(errorText(e));
        if (e instanceof ChatError && e.code === "rate_limited") {
          setQuota((q) => (q ? { ...q, remaining: 0 } : q));
        }
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const send = (text: string) => {
    const content = text.trim();
    if (!content || busy || !model) return;
    setInput("");
    const mine: Turn = { role: "user", content };
    if (active) {
      void run(active.id, [...active.turns, mine], true);
      return;
    }
    const id = newId();
    setChats((all) =>
      [{ id, title: titleOf(content), turns: [], updatedAt: Date.now() }, ...all].slice(0, MAX_CHATS),
    );
    setActiveId(id);
    void run(id, [mine], true);
  };

  useEffect(() => {
    if (!loaded || !autoAsk || busy) return;
    setAutoAsk(null);
    send(autoAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the saved chats are in
  }, [loaded, autoAsk]);

  /** Question-and-answer pairs of the open chat that can be published (failed answers left out). */
  const shareable = (): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (let i = 0; i + 1 < turns.length; i++) {
      const q = turns[i]!;
      const a = turns[i + 1]!;
      if (q.role === "user" && a.role === "assistant" && a.content && !a.failed) {
        out.push({ role: "user", content: q.content }, { role: "assistant", content: a.content });
        i++;
      }
    }
    return out.slice(-CHAT_HISTORY_MAX * 2);
  };

  const shareNow = async () => {
    if (!active || busy || sharing) return;
    const messages = shareable();
    if (!messages.length) return;
    const last = [...turns].reverse().find((m) => m.role === "assistant" && m.content && !m.failed);
    const links = store.get<Record<string, { id: string; n: number }>>(SHARE_OF_KEY, {});
    setSharing(true);
    setError("");
    try {
      let id = links[active.id]?.n === messages.length ? links[active.id]!.id : "";
      if (!id) {
        const res = await shareChat(publicConfig.apiUrl, {
          model: last?.model ?? model,
          title: active.title.slice(0, 120),
          messages,
        });
        id = res.id;
        store.set(SHARE_OF_KEY, { ...links, [active.id]: { id, n: messages.length } });
        store.set(SHARE_TOKENS_KEY, {
          ...store.get<Record<string, string>>(SHARE_TOKENS_KEY, {}),
          [id]: res.token,
        });
      }
      const url = `${window.location.origin}/c/${id}`;
      let copied = true;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        copied = false;
      }
      setShared({ chatId: active.id, url, copied });
    } catch (e) {
      setError(e instanceof ChatError && e.code === "answer_not_verified" ? t.shareOld : t.shareFailed);
    } finally {
      setSharing(false);
    }
  };

  const regenerate = () => {
    if (!active || busy) return;
    const history = active.turns.slice(0, -1);
    if (history[history.length - 1]?.role !== "user") return;
    void run(active.id, history, false);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const openChat = (id: string | null) => {
    setActiveId(id);
    setError("");
    setListOpen(false);
    inputRef.current?.focus();
  };

  const removeChat = (id: string) => {
    setChats((all) => all.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const byId = (id?: string) => models.find((m) => m.id === id);
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const lastAi = turns.length - 1;

  return (
    <div className="chat-app">
      <h1 className="sr-only">{t.title}</h1>

      <aside className={listOpen ? "chat-side open" : "chat-side"} aria-label={t.chats}>
        <button className="btn sm side-new" type="button" disabled={busy} onClick={() => openChat(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          {t.newChat}
        </button>
        <div className="side-h">{t.chats}</div>
        {sorted.length ? (
          <ul className="side-list">
            {sorted.map((c) => (
              <li key={c.id} className={c.id === activeId ? "on" : undefined}>
                <button
                  className="side-item"
                  type="button"
                  disabled={busy}
                  aria-current={c.id === activeId ? "true" : undefined}
                  onClick={() => openChat(c.id)}
                >
                  {c.title}
                </button>
                <button
                  className="side-del"
                  type="button"
                  disabled={busy}
                  aria-label={t.deleteChat(c.title)}
                  title={t.deleteChat(c.title)}
                  onClick={() => removeChat(c.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="side-empty">{t.noChats}</p>
        )}
        {premium.length > 0 && (
          <a
            className="side-premium"
            href={brand.tokenEnabled ? "/#token" : "/#pricing"}
            title={premium.map((m) => m.name).join(", ")}
          >
            {t.premium(premium.length)}
          </a>
        )}
        <p className="side-note">{t.local}</p>
      </aside>
      {listOpen && (
        <button
          className="side-scrim"
          type="button"
          aria-label={t.closeList}
          onClick={() => setListOpen(false)}
        />
      )}

      <section className="chat-main">
        <div className="chat-top">
          <button
            className="side-toggle"
            type="button"
            aria-label={t.openList}
            aria-expanded={listOpen}
            onClick={() => setListOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="chat-models" role="radiogroup" aria-label={t.pick}>
            {free.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === model}
                className={m.id === model ? "cm on" : "cm"}
                disabled={busy}
                title={m.bestFor}
                onClick={() => pick(m.id)}
              >
                <ProviderMark provider={m.provider} color={m.providerColor} size={20} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          {premium.length > 0 && (
            <a
              className="chat-premium"
              href={brand.tokenEnabled ? "/#token" : "/#pricing"}
              title={premium.map((m) => m.name).join(", ")}
            >
              {t.premium(premium.length)}
            </a>
          )}
          {active && !busy && turns.some((m) => m.role === "assistant" && m.content && !m.failed) && (
            <div className="chat-share">
              {shared?.chatId === active.id && (
                <a href={shared.url} target="_blank" rel="noopener">
                  {shared.copied ? t.shareCopied : t.shareOpen}
                </a>
              )}
              <button className="btn dark sm" type="button" disabled={sharing} onClick={shareNow}>
                <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {sharing ? t.sharing : t.share}
              </button>
            </div>
          )}
        </div>

        <div className="chat-log" ref={logRef} aria-live="polite">
          {turns.length === 0 ? (
            <div className="chat-empty">
              {current && (
                <ProviderMark provider={current.provider} color={current.providerColor} size={44} />
              )}
              <h2>{t.empty}</h2>
              <p>{t.lede}</p>
              <div className="chat-sugg">
                {t.suggestions.map((s) => (
                  <button key={s} type="button" className="chip" disabled={busy} onClick={() => send(s)}>
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
                  {byId(m.model) && (
                    <ProviderMark
                      provider={byId(m.model)!.provider}
                      color={byId(m.model)!.providerColor}
                      size={26}
                    />
                  )}
                  <div className="ai-body">
                    <div className="ai-name">{byId(m.model)?.name}</div>
                    {m.content ? (
                      <Answer text={m.content} codeLabel={t.code} />
                    ) : (
                      <div className="typing" role="status" aria-label={t.stop}>
                        <i />
                        <i />
                        <i />
                      </div>
                    )}
                    {m.content && !(busy && i === lastAi) && (
                      <div className="ai-actions">
                        <CopyButton text={m.content} label={t.copyAnswer} />
                        {i === lastAi && (
                          <button type="button" className="act" disabled={busy} onClick={regenerate}>
                            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            {t.regenerate}
                          </button>
                        )}
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
            send(input);
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
          <span className="hint">{t.hint}</span>
          {quota && (
            <span className={quota.remaining === 0 ? "quota out" : "quota"}>
              {t.quota(quota.remaining, quota.limit)}
            </span>
          )}
        </div>
        <div ref={tsSlot} />
      </section>
    </div>
  );
}

/** An answer: Markdown text, with code blocks that have their own Copy button. */
function Answer({ text, codeLabel }: { text: string; codeLabel: string }) {
  const parts = text.split("```");
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part.trim() ? (
            <div key={i} className="lb" dangerouslySetInnerHTML={{ __html: md(part) }} />
          ) : null;
        }
        const nl = part.indexOf("\n");
        const lang = nl >= 0 ? part.slice(0, nl).trim() : "";
        const code = (nl >= 0 ? part.slice(nl + 1) : part).replace(/\n$/, "");
        return <CodeBlock key={i} lang={/^[\w+#.-]{1,20}$/.test(lang) ? lang : codeLabel} code={code} />;
      })}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const d = useT();
  const { state, copy } = useCopy();
  return (
    <div className="codeblk">
      <div className="codehead">
        <span>{lang}</span>
        <button type="button" className="act" onClick={() => copy(code)}>
          {d.copy[state]}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const d = useT();
  const { state, copy } = useCopy();
  return (
    <button type="button" className="act" onClick={() => copy(text)}>
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9 9h10v10H9zM5 15V5h10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {state === "copy" ? label : d.copy[state]}
    </button>
  );
}
