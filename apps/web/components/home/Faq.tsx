import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";

export function Faq({ locale }: { locale: Locale }) {
  const t = getDict(locale).faq;
  return (
    <section className="block" id="faq">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            {t.kick}
          </div>
          <h2>{t.h2}</h2>
        </div>
        <div className="faq">
          {t.items.map(([q, a, privacy]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>
                {a}
                {privacy && (
                  <>
                    {" "}
                    <Link href="/privacy">{privacy}</Link>.
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
