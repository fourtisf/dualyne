import { brand } from "@refract/config";

/** Public runtime settings (inlined at build time by Next.js). */
export const publicConfig = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || brand.apiOrigin).replace(/\/$/, ""),
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
  compareLimitPerHour: Number(process.env.NEXT_PUBLIC_COMPARE_LIMIT_PER_HOUR || 10),
  /** Chain used for WalletConnect sessions (sign-in uses the chain the API returns). */
  siweChainId: Number(process.env.NEXT_PUBLIC_SIWE_CHAIN_ID || 1),
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  /** Token launch details (empty until launch). */
  rfxTokenAddress: process.env.NEXT_PUBLIC_RFX_TOKEN_ADDRESS || "",
  rfxBuyUrl: process.env.NEXT_PUBLIC_RFX_BUY_URL || "",
  rfxChartUrl: process.env.NEXT_PUBLIC_RFX_CHART_URL || "",
  /** Block explorer base URL, e.g. https://basescan.org */
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL || "").replace(/\/$/, ""),
};
