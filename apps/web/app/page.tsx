import { getCatalog } from "@/lib/catalog";
import { ApiSection } from "@/components/home/ApiSection";
import { Closing } from "@/components/home/Closing";
import { Faq } from "@/components/home/Faq";
import { Features } from "@/components/home/Features";
import { Hero } from "@/components/home/Hero";
import { HomeEffects } from "@/components/home/HomeEffects";
import { Logos } from "@/components/home/Logos";
import { ModelsSection } from "@/components/home/ModelsSection";
import { Pricing } from "@/components/home/Pricing";
import { TokenSection } from "@/components/home/TokenSection";

export const revalidate = 60;

export default async function HomePage() {
  const models = await getCatalog();
  return (
    <main id="top">
      <Hero models={models} />
      <Logos />
      <Features />
      <ModelsSection models={models} />
      <ApiSection />
      <Pricing />
      <TokenSection />
      <Faq />
      <Closing />
      <HomeEffects />
    </main>
  );
}
