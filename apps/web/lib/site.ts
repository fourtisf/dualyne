import type { Metadata, Viewport } from "next";
import { brand } from "@dualyne/config";
import { getDict, type Locale } from "./i18n";

/** Site-wide metadata for a language's root layout. */
export function siteMetadata(locale: Locale): Metadata {
  const t = getDict(locale);
  const title = `${brand.name} — ${t.meta.tagline.replace(/\.$/, "")}`;
  const home = "/";
  // "@DualyneAi" from https://x.com/DualyneAi, so link previews on X credit the account.
  const xHandle = /^https:\/\/(?:x|twitter)\.com\/(\w{1,15})\/?$/.exec(brand.social.x)?.[1];
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
    twitter: {
      card: "summary_large_image",
      title,
      description: t.meta.description,
      ...(xHandle ? { site: `@${xHandle}`, creator: `@${xHandle}` } : {}),
    },
    robots: { index: true, follow: true },
  };
}

/** Home page alternates. */
export const homeAlternates = (_locale: Locale): Metadata["alternates"] => ({ canonical: "/" });

export const siteViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050507",
  colorScheme: "dark",
};
