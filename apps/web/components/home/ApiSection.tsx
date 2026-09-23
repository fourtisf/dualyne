"use client";

import { useRef, useState } from "react";
import { brand } from "@refract/config";
import type { Dict } from "@/lib/i18n";
import { useT } from "../LocaleProvider";
import { Check } from "./Check";

const base = brand.apiBaseUrl;
const envName = `${brand.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;

/** Highlighted snippets (static strings from config and the dictionary, no user input). */
const code = (t: Dict): Record<"curl" | "py" | "js", string> => ({
  curl: `<span class="f">curl</span> ${base}/chat/completions \\
  -H <span class="s">"Authorization: Bearer $${envName}"</span> \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "model": "claude-swift",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'</span>`,
  py: `<span class="k">import</span> os
<span class="k">from</span> openai <span class="k">import</span> OpenAI

client = <span class="f">OpenAI</span>(
    base_url=<span class="s">"${base}"</span>,
    api_key=os.environ[<span class="s">"${envName}"</span>],
)

reply = client.chat.completions.<span class="f">create</span>(
    model=<span class="s">"gemini"</span>,  <span class="c">${t.api.swap}</span>
    messages=[{<span class="s">"role"</span>: <span class="s">"user"</span>, <span class="s">"content"</span>: <span class="s">"Hello"</span>}],
)`,
  js: `<span class="k">import</span> OpenAI <span class="k">from</span> <span class="s">"openai"</span>;

<span class="k">const</span> client = <span class="k">new</span> <span class="f">OpenAI</span>({
  baseURL: <span class="s">"${base}"</span>,
  apiKey: process.env.${envName},
});

<span class="k">const</span> reply = <span class="k">await</span> client.chat.completions.<span class="f">create</span>({
  model: <span class="s">"gpt"</span>,
  messages: [{ role: <span class="s">"user"</span>, content: <span class="s">"Hello"</span> }],
});`,
});

const TABS = [
  ["curl", "cURL"],
  ["py", "Python"],
  ["js", "Node.js"],
] as const;

export function ApiSection() {
  const d = useT();
  const t = d.api;
  const CODE = code(d);
  const [tab, setTab] = useState<keyof typeof CODE>("curl");
  const [copyState, setCopyState] = useState<"copy" | "copied" | "select">("copy");
  const box = useRef<HTMLPreElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(box.current?.textContent ?? "");
      setCopyState("copied");
    } catch {
      setCopyState("select");
    }
    setTimeout(() => setCopyState("copy"), 1600);
  };

  return (
    <section className="block" id="api">
      <div className="wrap api">
        <div>
          <div className="head" style={{ margin: 0 }}>
            <div className="kick">
              <i />
              {t.kick}
            </div>
            <h2>{t.h2}</h2>
            <p>{t.p}</p>
          </div>
          <ul className="list">
            {t.list.map(([strong, rest]) => (
              <li key={strong}>
                <Check size={16} color="var(--cyan)" width={1.7} />
                <span>
                  <strong>{strong}</strong>
                  {rest}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="code">
          <div className="tabs" role="tablist" aria-label={t.tabs}>
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
            <button className="copy" id="copyCode" type="button" onClick={copy}>
              {d.copy[copyState]}
            </button>
          </div>
          <pre id="codeBox" ref={box} dangerouslySetInnerHTML={{ __html: CODE[tab] }} />
        </div>
      </div>
    </section>
  );
}
