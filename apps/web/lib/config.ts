import { brand } from "@refract/config";

/** Public runtime settings (inlined at build time by Next.js). */
export const publicConfig = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || brand.apiOrigin).replace(/\/$/, ""),
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
  compareLimitPerHour: Number(process.env.NEXT_PUBLIC_COMPARE_LIMIT_PER_HOUR || 10),
};
