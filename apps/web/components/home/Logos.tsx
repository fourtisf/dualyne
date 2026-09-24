import type { CSSProperties } from "react";
import { getDict, type Locale } from "@/lib/i18n";

/** Model makers with their monochrome logo in public/providers/mono (from @lobehub/icons, MIT). */
const MAKERS: [name: string, logo: string][] = [
  ["Anthropic", "anthropic"],
  ["OpenAI", "openai"],
  ["Google", "google"],
  ["Meta", "meta"],
  ["Mistral", "mistral"],
  ["DeepSeek", "deepseek"],
  ["Qwen", "qwen"],
  ["xAI", "xai"],
  ["Cohere", "cohere"],
];

const Maker = ({ name, logo }: { name: string; logo: string }) => (
  <li>
    <span
      className="lmark"
      style={{ "--m": `url(/providers/mono/${logo}.svg)` } as CSSProperties}
      aria-hidden="true"
    />
    {name}
  </li>
);

export function Logos({ locale }: { locale: Locale }) {
  return (
    <section className="logos">
      <div className="wrap">
        <p>{getDict(locale).logos.caption}</p>
        <div className="marquee">
          <div className="track">
            <ul>
              {MAKERS.map(([n, l]) => (
                <Maker key={n} name={n} logo={l} />
              ))}
            </ul>
            <ul aria-hidden="true">
              {MAKERS.map(([n, l]) => (
                <Maker key={n} name={n} logo={l} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
