/**
 * The one place for brand values. "Refract", "RFX" and "refract.dev" are placeholders:
 * change them here (or set SITE_DOMAIN / NEXT_PUBLIC_SITE_DOMAIN for the domain) and the
 * website, docs, code samples, API messages and key prefix all follow.
 */

// NEXT_PUBLIC_ is inlined into the browser bundle by Next.js; the API reads SITE_DOMAIN.
const domain =
  (typeof process !== "undefined" && (process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN)) ||
  "refract.dev";

export const brand = {
  name: "Refract",
  /** Token symbol without the "$". Rendered as "$RFX" or "100,000 RFX". */
  tokenSymbol: "RFX",
  tokenName: "Refract access token",
  domain,
  siteUrl: `https://${domain}`,
  apiOrigin: `https://api.${domain}`,
  apiBaseUrl: `https://api.${domain}/v1`,
  /** Prefix of every API key. */
  keyPrefix: "rf_live_",
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
  legalName: "Refract",
  copyrightYear: 2026,
} as const;

export type Brand = typeof brand;

/** "$RFX" */
export const tokenTicker = `$${brand.tokenSymbol}`;
