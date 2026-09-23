import type { Metadata, Viewport } from "next";
import { brand } from "@dualyne/config";
import { getDict, type Locale } from "./i18n";

/** Site-wide metadata for a language's root layout. */
export function siteMetadata(locale: Locale): Metadata {
  const t = getDict(locale);
  const title = `${brand.name} — ${t.meta.tagline.replace(/\.$/, "")}`;
  const home = locale === "en" ? "/" : "/id";
  return {
    metadataBase: new URL(brand.siteUrl),
    title: { default: title, template: `%s — ${brand.name}` },
    description: t.meta.description,
    applicationName: brand.name,
    alternates: { canonical: home },
    openGraph: {
      type: "website",
      siteName: brand.name,
      title,
      description: t.meta.description,
      url: home,
      locale: t.meta.ogLocale,
    },
    twitter: { card: "summary_large_image", title, description: t.meta.description },
    robots: { index: true, follow: true },
  };
}

/** Home page alternates: each language points at the other (hreflang). */
export const homeAlternates = (locale: Locale): Metadata["alternates"] => ({
  canonical: locale === "en" ? "/" : "/id",
  languages: { en: "/", id: "/id", "x-default": "/" },
});

export const siteViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050507",
  colorScheme: "dark",
};
