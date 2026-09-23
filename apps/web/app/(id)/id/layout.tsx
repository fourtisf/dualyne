import type { ReactNode } from "react";
import { SiteShell } from "@/components/SiteShell";
import { siteMetadata, siteViewport } from "@/lib/site";
import "../../globals.css";

export const metadata = siteMetadata("id");
export const viewport = siteViewport;

/** Bahasa Indonesia: the home page and the dashboard. Other pages are in English. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return <SiteShell locale="id">{children}</SiteShell>;
}
