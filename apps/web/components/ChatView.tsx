"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  CHAT_ATTACHMENTS_PER_MESSAGE,
  CHAT_HISTORY_MAX,
  CHAT_INSTRUCTIONS_MAX,
  CHAT_MESSAGE_MAX,
  type CatalogModel,
  type ChatMessage,
  type ChatQuota,
  type ChatTurn,
} from "@dualyne/shared";
import {
  ACCEPT,
  AttachError,
  forStorage,
  isSendable,
  readAttachment,
  type Attached,
} from "@/lib/attachments";
import { ChatError, getChatQuota, runChat, shareChat } from "@/lib/chat-client";
import { publicConfig } from "@/lib/config";
import { formatWait } from "@/lib/i18n";
import { md } from "@/lib/markdown";
import { canDictate, canSpeak, dictate, speak, stopSpeaking } from "@/lib/speech";
import { store } from "@/lib/storage";
import { TurnstileRunner } from "@/lib/turnstile";
import { useCopy } from "@/lib/useCopy";
import { useT } from "./LocaleProvider";
import { openPro, PRO_CHANGED_EVENT } from "./ProDialog";
import { ProviderMark } from "./ProviderMark";
import { useWallet } from "./WalletProvider";

interface Source {
  url: string;
  title: string;
}

/** One model's answer when several models were asked at once. */
interface Alt {
  model: string;
  content: string;
  failed?: boolean;
  /** Why this model didn't answer (a limit, an error). */
  error?: string;
  sources?: Source[];
}

interface Turn extends ChatMessage {
  /** The model that wrote an assistant turn (the chosen one when several answered). */
  model?: string;
  /** An answer that stopped part-way. */
  failed?: boolean;
  /** Files on the visitor's message. Their contents live only in memory. */
  attachments?: Attached[];
  /** Web pages the answer used. */
  sources?: Source[];
  /** Answers from several models; `picked` is the one the conversation continues with. */
  alts?: Alt[];
  picked?: number;
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
const INSTRUCTIONS_KEY = "dualyne.chat.instructions";
/** chat id → the link it was shared as (and how many messages it held then). */
const SHARE_OF_KEY = "dualyne.chatShareOf";
/** share id → delete token; only this browser can remove the link. */
const SHARE_TOKENS_KEY = "dualyne.chatShares";
/** The single conversation the first version of this page kept. */
const OLD_KEY = "dualyne.chat";
const MAX_CHATS = 30;
const MULTI_MAX = 4;
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

/** File contents stay in memory: saved chats keep only the file names. */
const forSaving = (chats: Conversation[]): Conversation[] =>
  chats.map((c) => ({
    ...c,
    turns: c.turns.map((m) => (m.attachments ? { ...m, attachments: forStorage(m.attachments) } : m)),
  }));

/** The conversation as the API takes it: answered turns, files where still in memory. */
const toApi = (history: Turn[]): ChatTurn[] =>
  history
    .filter((m) => !m.failed && (m.content || m.attachments?.length))
    .slice(-CHAT_HISTORY_MAX)
    .map((m) => {
      if (m.role === "assistant") return { role: "assistant", content: m.content };
      const files = (m.attachments ?? []).filter(isSendable);
      const content = m.content || (files.length ? "" : (m.attachments ?? []).map((a) => a.name).join(", "));
      return files.length ? { role: "user", content, attachments: files } : { role: "user", content };
    });

const hasImages = (turns: Turn[], pending: Attached[]) =>
  [...turns.flatMap((m) => m.attachments ?? []), ...pending].some((a) => a.kind === "image" && isSendable(a));

/**
 * Chat with one AI at a time, like a regular chat app: past chats on the left, a model picker on
 * top, the conversation in the middle and the message box pinned to the bottom. Files, web
 * search, several models at once, templates, custom instructions and voice. Free models for
 * everyone, premium models on Pro. Chats are kept in this browser (localStorage), never on the server.
 */
export function ChatView({ models }: { models: CatalogModel[] }) {
  const d = useT();
  const t = d.chat;
  const w = useWallet();
  const free = models.filter((m) => m.minTier === "explorer" && m.live);
  const premium = models.filter((m) => m.minTier !== "explorer" && m.live);

  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState(free[0]?.id ?? "");
  /** Models asked together ("Ask several"), or null to ask just `model`. */
  const [multi, setMulti] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attached[]>([]);
  const [web, setWeb] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<ChatQuota | null>(null);
  const [listOpen, setListOpen] = useState(false);
  /** Saving starts only after saved chats were read, so it can't overwrite them. */
  const [loaded, setLoaded] = useState(false);
  /** A question typed on the home page (/chat?q=…&m=…), asked once the chat has loaded. */
  const [autoAsk, setAutoAsk] = useState<string | null>(null);
  /** The public link of the open chat after Share, and whether it reached the clipboard. */
  const [shared, setShared] = useState<{ chatId: string; url: string; copied: boolean } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [voiceOk, setVoiceOk] = useState({ dictate: false, speak: false });

  const aborts = useRef<AbortController[]>([]);
  const stopListening = useRef<(() => void) | null>(null);
  const tsSlot = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileRunner | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const turns = active?.turns ?? NO_TURNS;
  const current = models.find((m) => m.id === model);
  const pro = quota?.plan === "pro";
  const usable = (m: CatalogModel) => m.minTier === "explorer" || pro;

  // Load saved chats (moving the first version's single chat over) and settings.
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
    setInstructions(store.get<string>(INSTRUCTIONS_KEY, ""));
    setVoiceOk({ dictate: canDictate(), speak: canSpeak() });
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") ?? "").trim().slice(0, CHAT_MESSAGE_MAX);
    const last = store.get<string | null>(ACTIVE_KEY, null);
    // A question from the home page starts a new chat.
    setActiveId(!q && saved.some((c) => c.id === last) ? last : null);
    const m = params.get("m") || store.get<string>(MODEL_KEY, "");
    if ([...free, ...premium].some((x) => x.id === m)) setModel(m);
    if (q) {
      setAutoAsk(q);
      // Drop the question from the address, so a reload doesn't ask it again.
      window.history.replaceState(null, "", window.location.pathname);
    }
    setLoaded(true);
    return () => {
      stopListening.current?.();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on load
  }, []);

  // The plan follows the signed-in wallet: re-read it on sign-in, sign-out and after paying.
  useEffect(() => {
    if (w.me === undefined) return;
    const load = () => void getChatQuota(publicConfig.apiUrl).then((q) => q && setQuota(q));
    load();
    window.addEventListener(PRO_CHANGED_EVENT, load);
    return () => window.removeEventListener(PRO_CHANGED_EVENT, load);
  }, [w.me]);
  // Without Pro, premium models picked earlier fall back to the free ones.
  useEffect(() => {
    if (!quota || pro) return;
    if (premium.some((m) => m.id === model)) setModel(free[0]?.id ?? "");
    setMulti((ids) => (ids ? ids.filter((id) => free.some((m) => m.id === id)) : ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the plan changes
  }, [quota?.plan]);

  useEffect(() => {
    if (!loaded || busy) return;
    store.set(CHATS_KEY, forSaving(chats));
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

  // Close the templates menu on a click elsewhere or Escape.
  useEffect(() => {
    if (!templatesOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest?.(".tpl")) {
        setTemplatesOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [templatesOpen]);

  useEffect(() => {
    const el = settingsRef.current;
    if (!el) return;
    if (settingsOpen && !el.open) el.showModal();
    if (!settingsOpen && el.open) el.close();
  }, [settingsOpen]);

  const pick = (id: string) => {
    if (multi) {
      setMulti((ids) => {
        const list = ids ?? [];
        if (list.includes(id)) return list.filter((x) => x !== id);
        return list.length >= MULTI_MAX ? list : [...list, id];
      });
      return;
    }
    setModel(id);
    store.set(MODEL_KEY, id);
    inputRef.current?.focus();
  };

  const toggleMulti = () => {
    setMulti((ids) =>
      ids ? null : [model, ...free.map((m) => m.id).filter((id) => id !== model)].slice(0, 2),
    );
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
  /** Change the last turn (the answer being written). */
  const setLast = (id: string, update: (turn: Turn) => Turn) =>
    setTurnsOf(id, (all) => [...all.slice(0, -1), update(all[all.length - 1]!)]);

  const token = async (): Promise<string | undefined> => {
    if (!turnstile.current) return undefined;
    try {
      return await turnstile.current.token();
    } catch {
      throw new ChatError("turnstile", "");
    }
  };

  const noteRemaining = (remaining: number | null) => {
    if (remaining === null) return;
    setQuota((q) => (q ? { ...q, remaining: Math.min(q.remaining, remaining) } : q));
  };

  /** One model answers `ask`; `update` receives its text and sources as they arrive. */
  const ask = async (
    id: string,
    askModel: string,
    history: ChatTurn[],
    update: (patch: Partial<Alt>) => void,
  ): Promise<boolean> => {
    const ac = new AbortController();
    aborts.current.push(ac);
    let answer = "";
    const result = await runChat(
      publicConfig.apiUrl,
      {
        model: askModel,
        messages: history,
        turnstileToken: await token(),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(web ? { webSearch: true } : {}),
      },
      (delta) => {
        answer += delta;
        update({ content: answer });
      },
      ac.signal,
      (sources) => update({ sources }),
    );
    noteRemaining(result.remaining);
    if (web) setQuota((q) => (q ? { ...q, webRemaining: Math.max(0, q.webRemaining - 1) } : q));
    if (premium.some((m) => m.id === askModel)) {
      setQuota((q) =>
        q?.plan === "pro" ? { ...q, premiumRemaining: Math.max(0, q.premiumRemaining - 1) } : q,
      );
    }
    if (!result.completed)
      update({ content: answer, failed: true, error: answer ? undefined : t.errors.failed });
    return result.completed;
  };

  /**
   * Answer `history` (which ends with the visitor's message) in conversation `id`, with one model
   * or several. `fresh` means that message was just typed: if nothing comes back it goes back
   * into the box.
   */
  const run = async (id: string, history: Turn[], fresh: boolean, askModels: string[]) => {
    setError("");
    const body = toApi(history);
    const several = askModels.length > 1;
    setTurnsOf(id, () => [
      ...history,
      several
        ? {
            role: "assistant",
            content: "",
            model: askModels[0],
            alts: askModels.map((m) => ({ model: m, content: "" })),
          }
        : { role: "assistant", content: "", model: askModels[0] },
    ]);
    setBusy(true);
    aborts.current = [];
    try {
      if (!several) {
        try {
          const ok = await ask(id, askModels[0]!, body, (patch) =>
            setLast(id, (turn) => ({
              ...turn,
              ...(patch.content !== undefined ? { content: patch.content } : {}),
              ...(patch.sources ? { sources: patch.sources } : {}),
              ...(patch.failed ? { failed: true } : {}),
            })),
          );
          if (!ok) {
            setError(t.errors.failed);
            setTurnsOf(id, (all) => (all[all.length - 1]?.content ? all : all.slice(0, -1)));
          }
        } catch (e) {
          if (e instanceof ChatError && e.code === "cancelled") {
            setTurnsOf(id, (all) => (all[all.length - 1]?.content ? all : all.slice(0, -1)));
          } else {
            setTurnsOf(id, (all) => all.slice(0, fresh ? -2 : -1));
            if (fresh) {
              const mine = history[history.length - 1]!;
              setInput(mine.content);
              setPending((mine.attachments ?? []).filter(isSendable));
            }
            setError(errorText(e));
            if (e instanceof ChatError && e.code === "rate_limited") {
              setQuota((q) => (q ? { ...q, remaining: 0 } : q));
            }
          }
        }
        return;
      }
      // Several models: each fills its own column; a refusal only affects that column.
      const updateAlt = (i: number, patch: Partial<Alt>) =>
        setLast(id, (turn) => {
          const alts = [...(turn.alts ?? [])];
          alts[i] = { ...alts[i]!, ...patch };
          return { ...turn, alts };
        });
      // Turnstile tokens are fetched one at a time, so the requests start in order.
      await Promise.all(
        askModels.map(async (m, i) => {
          try {
            await ask(id, m, body, (patch) => updateAlt(i, patch));
          } catch (e) {
            if (e instanceof ChatError && e.code === "cancelled") return;
            updateAlt(i, { failed: true, error: errorText(e) });
          }
        }),
      );
      // Continue with the first model that answered in full.
      setLast(id, (turn) => {
        const alts = turn.alts ?? [];
        const i = alts.findIndex((a) => a.content && !a.failed);
        if (i < 0) return { ...turn, failed: true, content: "" };
        return {
          ...turn,
          picked: i,
          model: alts[i]!.model,
          content: alts[i]!.content,
          sources: alts[i]!.sources,
        };
      });
    } finally {
      setBusy(false);
      aborts.current = [];
    }
  };

  const choose = (i: number) =>
    active &&
    setLast(active.id, (turn) => {
      const alt = turn.alts?.[i];
      if (!alt || !alt.content || alt.failed) return turn;
      return {
        ...turn,
        picked: i,
        model: alt.model,
        content: alt.content,
        sources: alt.sources,
        failed: false,
      };
    });

  const targets = (): string[] | null => {
    if (!multi) return model ? [model] : null;
    return multi.length >= 2 ? multi : null;
  };

  const send = (text: string) => {
    const content = text.trim();
    if ((!content && !pending.length) || busy) return;
    const askModels = targets();
    if (!askModels) {
      setError(t.askAllPick);
      return;
    }
    if (hasImages(turns, pending)) {
      const blind = askModels.map((id) => models.find((m) => m.id === id)).find((m) => m && !m.vision);
      if (blind) {
        setError(t.errors.noVision(blind.name));
        return;
      }
    }
    stopListening.current?.();
    setInput("");
    const mine: Turn = { role: "user", content, ...(pending.length ? { attachments: pending } : {}) };
    setPending([]);
    if (active) {
      void run(active.id, [...active.turns, mine], true, askModels);
      return;
    }
    const id = newId();
    const title = titleOf(content || pending.map((a) => a.name).join(", ") || t.newChat);
    setChats((all) => [{ id, title, turns: [], updatedAt: Date.now() }, ...all].slice(0, MAX_CHATS));
    setActiveId(id);
    void run(id, [mine], true, askModels);
  };

  useEffect(() => {
    if (!loaded || !autoAsk || busy) return;
    setAutoAsk(null);
    send(autoAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the saved chats are in
  }, [loaded, autoAsk]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const room = CHAT_ATTACHMENTS_PER_MESSAGE - pending.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    for (const f of list) {
      try {
        const a = await readAttachment(f);
        setPending((p) => (p.length < CHAT_ATTACHMENTS_PER_MESSAGE ? [...p, a] : p));
      } catch (e) {
        setError(e instanceof AttachError ? e.message : t.errors.failed);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    inputRef.current?.focus();
  };

  const toggleVoice = () => {
    if (listening) {
      stopListening.current?.();
      return;
    }
    setError("");
    const before = input ? `${input.trimEnd()} ` : "";
    setListening(true);
    stopListening.current = dictate(
      (heard) => setInput(before + heard),
      (err) => {
        setListening(false);
        stopListening.current = null;
        if (err && err !== "no-speech" && err !== "aborted") setError(t.errors.mic);
      },
    );
  };

  const readAloud = (i: number, text: string) => {
    if (speaking === i) {
      stopSpeaking();
      setSpeaking(null);
      return;
    }
    setSpeaking(i);
    speak(text, () => setSpeaking((s) => (s === i ? null : s)));
  };

  const saveInstructions = (text: string) => {
    const v = text.trim().slice(0, CHAT_INSTRUCTIONS_MAX);
    setInstructions(v);
    store.set(INSTRUCTIONS_KEY, v);
    setSettingsOpen(false);
  };

  /** Question-and-answer pairs of the open chat that can be published (failed answers left out). */
  const shareable = (): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (let i = 0; i + 1 < turns.length; i++) {
      const q = turns[i]!;
      const a = turns[i + 1]!;
      if (q.role === "user" && a.role === "assistant" && a.content && !a.failed) {
        const files = (q.attachments ?? []).map((f) => `📎 ${f.name}`).join("\n");
        const question = [q.content, files].filter(Boolean).join("\n\n");
        out.push({ role: "user", content: question }, { role: "assistant", content: a.content });
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
    const lastTurn = active.turns[active.turns.length - 1];
    const history = active.turns.slice(0, -1);
    if (history[history.length - 1]?.role !== "user") return;
    const again = lastTurn?.alts?.length ? lastTurn.alts.map((a) => a.model) : [lastTurn?.model ?? model];
    void run(
      active.id,
      history,
      false,
      again.filter((id) => models.some((m) => m.id === id && usable(m))),
    );
  };

  const stop = () => aborts.current.forEach((ac) => ac.abort());

  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
  const chosen = (id: string) => (multi ? multi.includes(id) : id === model);
  const placeholder = multi
    ? multi.length >= 2
      ? t.askAllCount(multi.length)
      : t.askAllPick
    : t.placeholder(current?.name ?? "");

  const chip = (m: CatalogModel) => {
    const locked = !usable(m);
    const on = !locked && chosen(m.id);
    const isPremium = m.minTier !== "explorer";
    return (
      <button
        key={m.id}
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={on}
        className={["cm", isPremium ? "pm" : "", on ? "on" : "", locked ? "locked" : ""]
          .filter(Boolean)
          .join(" ")}
        disabled={busy}
        title={locked ? t.locked(m.name) : `${m.bestFor}${m.vision ? ` · ${t.seesImages}` : ""}`}
        onClick={() => (locked ? openPro() : pick(m.id))}
      >
        <ProviderMark provider={m.provider} color={m.providerColor} size={20} />
        <span>{m.name}</span>
        {m.vision && (
          <svg className="cm-eye" width="12" height="12" viewBox="0 0 24 24" aria-label={t.seesImages}>
            <path
              d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        )}
        {isPremium && (
          <em className="cm-pro">
            {locked && (
              <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {t.proBadge}
          </em>
        )}
      </button>
    );
  };

  const answerActions = (i: number, text: string, withCopy = true) => (
    <div className="ai-actions">
      {withCopy && <CopyButton text={text} label={t.copyAnswer} />}
      {voiceOk.speak && (
        <button
          type="button"
          className="act"
          aria-pressed={speaking === i}
          onClick={() => readAloud(i, text)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {speaking === i ? t.stopReading : t.readAloud}
        </button>
      )}
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
  );

  const sourcesList = (sources?: Source[]) =>
    sources?.length ? (
      <div className="ai-sources">
        <span>{t.sources}</span>
        <ol>
          {sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                {s.title}
              </a>
              <small>{hostOf(s.url)}</small>
            </li>
          ))}
        </ol>
      </div>
    ) : null;

  const typing = (
    <div className="typing" role="status" aria-label={t.stop}>
      <i />
      <i />
      <i />
    </div>
  );

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
        <button className="side-set" type="button" onClick={() => setSettingsOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="16" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="10" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="18" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          {t.settings}
          {instructions && <i className="on-dot" aria-label={t.instructionsOn} />}
        </button>
        {premium.length > 0 && !pro && (
          <button
            className="side-premium"
            type="button"
            title={premium.map((m) => m.name).join(", ")}
            onClick={openPro}
          >
            {t.premium(premium.length)}
          </button>
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
          <button
            className={multi ? "multi-tg on" : "multi-tg"}
            type="button"
            aria-pressed={Boolean(multi)}
            title={t.askAllTitle}
            disabled={busy}
            onClick={toggleMulti}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <rect
                x="3"
                y="4"
                width="7"
                height="16"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <rect
                x="14"
                y="4"
                width="7"
                height="16"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
            <span>{t.askAll}</span>
          </button>
          <div
            className="chat-models"
            role={multi ? "group" : "radiogroup"}
            aria-label={multi ? t.askAllPick : t.pick}
          >
            {free.map(chip)}
            {premium.map(chip)}
          </div>
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
              {current && !multi && (
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
            turns.map((m, i) => {
              if (m.role === "user") {
                return (
                  <div key={i} className="msg-user">
                    {m.attachments?.length ? (
                      <div className="u-files">
                        {m.attachments.map((a, j) => (
                          <FileChip key={j} file={a} goneLabel={t.fileGone} />
                        ))}
                      </div>
                    ) : null}
                    {m.content && <div className="bubble">{m.content}</div>}
                  </div>
                );
              }
              if (m.alts?.length) {
                return (
                  <div key={i} className="msg-multi">
                    {m.alts.map((a, j) => {
                      const info = byId(a.model);
                      const isChosen = m.picked === j;
                      return (
                        <div key={j} className={isChosen ? "alt on" : "alt"}>
                          <div className="alt-h">
                            {info && (
                              <ProviderMark provider={info.provider} color={info.providerColor} size={20} />
                            )}
                            <b>{info?.name ?? a.model}</b>
                          </div>
                          {a.error ? (
                            <p className="alt-err">{a.error}</p>
                          ) : a.content ? (
                            <Answer text={a.content} codeLabel={t.code} />
                          ) : busy && i === lastAi ? (
                            typing
                          ) : null}
                          {sourcesList(a.sources)}
                          {!(busy && i === lastAi) && a.content && !a.failed && (
                            <div className="alt-f">
                              {isChosen ? (
                                <span className="alt-chosen">✓ {t.chosen}</span>
                              ) : (
                                <button type="button" className="act" onClick={() => choose(j)}>
                                  {t.useThis}
                                </button>
                              )}
                              <CopyButton text={a.content} label={t.copyAnswer} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!busy && i === lastAi && (
                      <div className="alt-more">{answerActions(i, m.content, false)}</div>
                    )}
                  </div>
                );
              }
              const info = byId(m.model);
              return (
                <div key={i} className="msg-ai">
                  {info && <ProviderMark provider={info.provider} color={info.providerColor} size={26} />}
                  <div className="ai-body">
                    <div className="ai-name">{info?.name}</div>
                    {m.content ? <Answer text={m.content} codeLabel={t.code} /> : typing}
                    {sourcesList(m.sources)}
                    {m.content && !(busy && i === lastAi) && answerActions(i, m.content)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <div className="chat-err" role="alert">
            {error}
          </div>
        )}

        <form
          className="chat-input composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          {pending.length > 0 && (
            <div className="cmp-files">
              {pending.map((a, j) => (
                <FileChip
                  key={j}
                  file={a}
                  goneLabel={t.fileGone}
                  onRemove={() => setPending((p) => p.filter((_, k) => k !== j))}
                  removeLabel={t.removeFile(a.name)}
                />
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={CHAT_MESSAGE_MAX}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
          />
          <div className="cmp-tools">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              type="button"
              className="tool"
              title={t.attach}
              aria-label={t.attach}
              disabled={busy || pending.length >= CHAT_ATTACHMENTS_PER_MESSAGE}
              onClick={() => fileRef.current?.click()}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className={web ? "tool wide on" : "tool wide"}
              aria-pressed={web}
              title={quota ? t.webTitle(quota.webRemaining, quota.webLimit) : t.web}
              disabled={busy}
              onClick={() => setWeb((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              <span>{t.web}</span>
              {quota && web && <small>{quota.webRemaining}</small>}
            </button>
            <div className="tpl">
              <button
                type="button"
                className={templatesOpen ? "tool wide on" : "tool wide"}
                aria-expanded={templatesOpen}
                aria-haspopup="menu"
                disabled={busy}
                onClick={() => setTemplatesOpen((v) => !v)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 5h16M4 10h10M4 15h16M4 20h7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <span>{t.templates}</span>
              </button>
              {templatesOpen && (
                <div className="tpl-menu" role="menu">
                  {t.templateList.map((x) => (
                    <button
                      key={x.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setInput(x.prompt + input);
                        setTemplatesOpen(false);
                        inputRef.current?.focus();
                      }}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {voiceOk.dictate && (
              <button
                type="button"
                className={listening ? "tool on rec" : "tool"}
                aria-pressed={listening}
                title={listening ? t.listening : t.speak}
                aria-label={listening ? t.listening : t.speak}
                disabled={busy}
                onClick={toggleVoice}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <rect
                    x="9"
                    y="3"
                    width="6"
                    height="11"
                    rx="3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M5 11a7 7 0 0 0 14 0M12 18v3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {busy ? (
              <button className="btn dark" type="button" onClick={stop}>
                {t.stop}
              </button>
            ) : (
              <button
                className="btn"
                type="submit"
                disabled={(!input.trim() && !pending.length) || !targets()}
              >
                {t.send}
              </button>
            )}
          </div>
        </form>
        <div className="chat-foot">
          <span className="hint">{instructions ? t.instructionsOn : t.hint}</span>
          {quota && (
            <span className={quota.remaining === 0 ? "quota out" : "quota"}>
              {quota.plan === "pro"
                ? t.quotaPro(quota.remaining, quota.limit, quota.premiumRemaining)
                : t.quota(quota.remaining, quota.limit)}
              {quota.plan === "free" && premium.length > 0 && (
                <>
                  {" · "}
                  <button className="link quota-up" type="button" onClick={openPro}>
                    {t.upgrade}
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        <div ref={tsSlot} />
      </section>

      <dialog
        ref={settingsRef}
        aria-labelledby="ciTitle"
        onClose={() => setSettingsOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSettingsOpen(false);
        }}
      >
        {settingsOpen && (
          <InstructionsForm
            initial={instructions}
            onSave={saveInstructions}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </dialog>
    </div>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function InstructionsForm({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave(text: string): void;
  onClose(): void;
}) {
  const t = useT().chat;
  const [text, setText] = useState(initial);
  return (
    <form
      className="m"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text);
      }}
    >
      <button className="mx" aria-label={t.close} type="button" onClick={onClose}>
        ×
      </button>
      <h3 id="ciTitle">{t.settings}</h3>
      <p>{t.instructionsHelp}</p>
      <textarea
        className="ci-text"
        value={text}
        rows={5}
        maxLength={CHAT_INSTRUCTIONS_MAX}
        placeholder={t.instructionsPlaceholder}
        aria-label={t.settings}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ci-row">
        <small>
          {text.length} / {CHAT_INSTRUCTIONS_MAX}
        </small>
        <button className="btn dark sm" type="button" onClick={() => onSave("")}>
          {t.clear}
        </button>
        <button className="btn sm" type="submit">
          {t.save}
        </button>
      </div>
    </form>
  );
}

/** A file on a message or waiting in the message box. */
function FileChip({
  file,
  goneLabel,
  onRemove,
  removeLabel,
}: {
  file: Attached;
  goneLabel: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const preview = file.kind === "image" && isSendable(file) ? file.data : null;
  return (
    <span
      className={isSendable(file) ? "fchip" : "fchip gone"}
      title={isSendable(file) ? file.name : goneLabel}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local data: URL
        <img src={preview} alt="" />
      ) : (
        <i className={`fi ${file.kind}`}>
          {file.kind === "pdf" ? "PDF" : file.kind === "image" ? "IMG" : "TXT"}
        </i>
      )}
      <span className="fn">{file.name}</span>
      {onRemove && (
        <button type="button" aria-label={removeLabel} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
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
