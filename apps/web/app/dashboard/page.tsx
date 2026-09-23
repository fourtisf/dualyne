import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
  alternates: { canonical: "/dashboard" },
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
