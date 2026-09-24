import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { Footer } from "./Footer";
import { LocaleProvider } from "./LocaleProvider";
import { Nav } from "./Nav";
import { PageView } from "./PageView";
import { WalletModal } from "./WalletModal";
import { WalletProvider } from "./WalletProvider";

/** The document shared by every language's root layout. */
export function SiteShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <LocaleProvider locale={locale}>
          <WalletProvider>
            <Nav />
            {children}
            <Footer locale={locale} />
            <WalletModal />
            <PageView />
          </WalletProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
