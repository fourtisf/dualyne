import type { Metadata } from "next";
import { ChatView } from "@/components/ChatView";
import { getCatalog } from "@/lib/catalog";
import { getDict } from "@/lib/i18n";

export const revalidate = 60;

const t = getDict("en").chat;
export const metadata: Metadata = {
  title: t.title,
  description: t.metaDesc,
  alternates: { canonical: "/chat" },
};

export default async function Page() {
  const { models } = await getCatalog();
  return (
    <main className="view">
      <div className="wrap">
        <ChatView models={models} />
      </div>
    </main>
  );
}
