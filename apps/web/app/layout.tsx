import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { brand } from "@refract/config";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { WalletModal } from "@/components/WalletModal";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

const title = `${brand.name} — ${brand.tagline.replace(/\.$/, "")}`;

export const metadata: Metadata = {
  metadataBase: new URL(brand.siteUrl),
  title: { default: title, template: `%s — ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: brand.name,
    title,
    description: brand.description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title, description: brand.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050507",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <WalletProvider>
          <Nav />
          {children}
          <Footer />
          <WalletModal />
        </WalletProvider>
      </body>
    </html>
  );
}
