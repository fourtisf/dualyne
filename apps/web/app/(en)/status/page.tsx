import type { Metadata } from "next";
import { StatusPage } from "@/components/StatusPage";
import { getDict } from "@/lib/i18n";
import { getStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

const t = getDict("en").statusPage;
export const metadata: Metadata = {
  title: t.title,
  description: t.metaDesc,
  alternates: {
    canonical: "/status",
  },
};

export default async function Page() {
  return <StatusPage locale="en" status={await getStatus()} />;
}
