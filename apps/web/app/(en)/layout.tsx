import type { ReactNode } from "react";
import { SiteShell } from "@/components/SiteShell";
import { siteMetadata, siteViewport } from "@/lib/site";
import "../globals.css";

export const metadata = siteMetadata("en");
export const viewport = siteViewport;

export default function RootLayout({ children }: { children: ReactNode }) {
  return <SiteShell locale="en">{children}</SiteShell>;
}
