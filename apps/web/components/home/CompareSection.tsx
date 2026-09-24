import type { CatalogModel } from "@dualyne/shared";
import { getDict, type Locale } from "@/lib/i18n";
import { CompareConsole } from "../CompareConsole";

/** Compare, as its own section under the hero: same prompt, two models, side by side. */
export function CompareSection({
  locale,
  models,
  blindMode,
}: {
  locale: Locale;
  models: CatalogModel[];
  blindMode: "optional" | "always";
}) {
  const t = getDict(locale).compareSection;
  return (
    <section className="block compare-block">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            {t.kick}
          </div>
          <h2>{t.h2}</h2>
          <p>{t.p}</p>
        </div>
        <CompareConsole models={models} blindMode={blindMode} />
      </div>
    </section>
  );
}
