/**
 * The one place for brand values: Dualyne, dualyne.com and the DLYN token. Change them here
 * (or set SITE_DOMAIN / NEXT_PUBLIC_SITE_DOMAIN for the domain) and the website, docs, code
 * samples, API messages and key prefix all follow. The logo pack in brand/ has its own
 * NAME and TOKEN at the top of brand/build.py.
 */

// NEXT_PUBLIC_ is inlined into the browser bundle by Next.js; the API reads SITE_DOMAIN.
const domain =
  (typeof process !== "undefined" && (process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN)) ||
  "dualyne.com";

export const brand = {
  name: "Dualyne",
  /** Token symbol without the "$". Rendered as "$DLYN" or "100,000 DLYN". */
  tokenSymbol: "DLYN",
  tokenName: "Dualyne access token",
  domain,
  siteUrl: `https://${domain}`,
  apiOrigin: `https://api.${domain}`,
  apiBaseUrl: `https://api.${domain}/v1`,
  /** Prefix of every API key. */
  keyPrefix: "dly_live_",
  tagline: "Every AI model, one prompt away.",
  description:
    "Send one prompt to two AI models at once and compare them side by side. Then ship the one you like through a single OpenAI-compatible API key.",
  /** Leave a link empty to hide its icon. Dead "#" links are never rendered. */
  social: {
    x: "",
    telegram: "",
    github: "",
  },
  /** Shown in the footer and on the legal pages. Empty hides the contact link. */
  contactEmail: "",
  /** Legal entity named in the Terms and Privacy pages. */
  legalName: "Dualyne",
  copyrightYear: 2026,
} as const;

export type Brand = typeof brand;

/** "$DLYN" */
export const tokenTicker = `$${brand.tokenSymbol}`;
