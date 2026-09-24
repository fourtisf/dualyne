"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_MESSAGE_MAX, type CatalogModel } from "@dualyne/shared";
import { useT } from "../LocaleProvider";
import { ProviderMark } from "../ProviderMark";

/**
 * The home page's question box: pick a free model, type, press Enter, and the Chat page opens
 * with the question already asked (/chat?q=…&m=…). No account, nothing stored here.
 */
export function HeroAsk({ models }: { models: CatalogModel[] }) {
  const t = useT().ask;
  const router = useRouter();
  const free = models.filter((m) => m.minTier === "explorer" && m.live);
  const [model, setModel] = useState(free[0]?.id ?? "");
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const go = (q: string) => {
    const question = q.trim();
    if (!question) {
      box.current?.focus();
      return;
    }
    const params = new URLSearchParams({ q: question.slice(0, CHAT_MESSAGE_MAX) });
    if (model) params.set("m", model);
    router.push(`/chat?${params.toString()}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      go(text);
    }
  };

  return (
    <div className="ask rise" style={{ "--d": ".3s" } as React.CSSProperties}>
      <form className="ask-box" onSubmit={onSubmit}>
        <label className="sr" htmlFor="ask">
          {t.label}
        </label>
        <textarea
          id="ask"
          ref={box}
          rows={1}
          value={text}
          maxLength={CHAT_MESSAGE_MAX}
          placeholder={t.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="ask-bar">
          {free.length > 0 && (
            <div className="ask-models" role="radiogroup" aria-label={t.model}>
              {free.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === model}
                  className={m.id === model ? "ask-m on" : "ask-m"}
                  onClick={() => setModel(m.id)}
                >
                  <ProviderMark provider={m.provider} color={m.providerColor} size={14} />
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <button className="ask-send" type="submit" aria-label={t.send}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 19V5M5 12l7-7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
      <div className="ask-tries">
        {t.tries.map((q) => (
          <button key={q} type="button" onClick={() => go(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
