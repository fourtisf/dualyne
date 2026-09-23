import type { Metadata } from "next";
import { StatusPage } from "@/components/StatusPage";
import { getDict } from "@/lib/i18n";
import { getStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

const t = getDict("id").statusPage;
export const metadata: Metadata = {
  title: t.title,
  description: t.metaDesc,
  alternates: {
    canonical: "/id/status",
    languages: { en: "/status", id: "/id/status", "x-default": "/status" },
  },
};

export default async function Page() {
  return <StatusPage locale="id" status={await getStatus()} />;
}
