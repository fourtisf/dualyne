import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModelPage } from "@/components/ModelPage";
import { getCatalog } from "@/lib/catalog";
import { getDict } from "@/lib/i18n";
import { getLeaderboard } from "@/lib/leaderboard";

export const revalidate = 300;

// Rendered on first request, then cached: at build time the API (prices, rankings) is not reachable.

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const { models } = await getCatalog();
  const m = models.find((x) => x.id === params.id);
  if (!m) return {};
  const t = getDict("en");
  return {
    title: t.modelPage.metaTitle(m.name),
    description: t.modelPage.metaDesc(m.name, m.provider, t.models.bestFor[m.id] ?? m.bestFor),
    alternates: {
      canonical: `/models/${m.id}`,
    },
  };
}

export default async function Page({ params }: { params: { id: string } }) {
  const [{ models }, board] = await Promise.all([getCatalog(), getLeaderboard()]);
  const model = models.find((m) => m.id === params.id);
  if (!model) notFound();
  return <ModelPage locale="en" model={model} models={models} board={board} />;
}
