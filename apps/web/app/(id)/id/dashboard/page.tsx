import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";

export const metadata: Metadata = {
  title: "Dasbor",
  robots: { index: false, follow: false },
  alternates: { canonical: "/id/dashboard" },
};

export default function DashboardPage() {
  return (
    <main className="view" id="view-dash">
      <div className="wrap" id="dashRoot">
        <DashboardView />
      </div>
    </main>
  );
}
