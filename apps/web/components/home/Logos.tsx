import { getDict, type Locale } from "@/lib/i18n";

const NAMES = ["Anthropic", "OpenAI", "Google", "Meta", "Mistral", "DeepSeek", "Qwen", "xAI", "Cohere"];

export function Logos({ locale }: { locale: Locale }) {
  return (
    <section className="logos">
      <div className="wrap">
        <p>{getDict(locale).logos.caption}</p>
        <div className="marquee">
          <div className="track">
            <ul>
              {NAMES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <ul aria-hidden="true">
              {NAMES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
