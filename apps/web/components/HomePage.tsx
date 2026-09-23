import type { Locale } from "@/lib/i18n";
import { getCatalog } from "@/lib/catalog";
import { getTreasury } from "@/lib/treasury";
import { ApiSection } from "./home/ApiSection";
import { Closing } from "./home/Closing";
import { Faq } from "./home/Faq";
import { Features } from "./home/Features";
import { Hero } from "./home/Hero";
import { HomeEffects } from "./home/HomeEffects";
import { Logos } from "./home/Logos";
import { ModelsSection } from "./home/ModelsSection";
import { Pricing } from "./home/Pricing";
import { TokenSection } from "./home/TokenSection";

export async function HomePage({ locale }: { locale: Locale }) {
  const [{ models, settings }, treasury] = await Promise.all([getCatalog(), getTreasury()]);
  return (
    <main id="top">
      <Hero locale={locale} models={models} blindMode={settings.blindMode} />
      <Logos locale={locale} />
      <Features locale={locale} />
      <ModelsSection models={models} />
      <ApiSection />
      <Pricing locale={locale} />
      <TokenSection locale={locale} treasury={treasury} />
      <Faq locale={locale} />
      <Closing locale={locale} />
      <HomeEffects />
    </main>
  );
}
