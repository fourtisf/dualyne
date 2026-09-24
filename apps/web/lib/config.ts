import { brand } from "@dualyne/config";

/** Public runtime settings (inlined at build time by Next.js). */
export const publicConfig = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || brand.apiOrigin).replace(/\/$/, ""),
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
  compareLimitPerHour: Number(process.env.NEXT_PUBLIC_COMPARE_LIMIT_PER_HOUR || 10),
  /** Plans, copied from the API's settings by deploy.sh so the pricing page matches what the API enforces. */
  freeChatPerDay: Number(process.env.NEXT_PUBLIC_CHAT_LIMIT_PER_DAY || 10),
  /** Wallets can create API keys. Off: the API is shown as coming soon. */
  apiOpen: process.env.NEXT_PUBLIC_API_OPEN === "true",
  /** Pro takes payments. Off: Pro is shown as coming soon. */
  proOpen: process.env.NEXT_PUBLIC_PRO_OPEN === "true",
  proPriceUsd: Number(process.env.NEXT_PUBLIC_PRO_PRICE_USD || 19),
  proDays: Number(process.env.NEXT_PUBLIC_PRO_DAYS || 30),
  proChatPerDay: Number(process.env.NEXT_PUBLIC_PRO_CHAT_PER_DAY || 300),
  proPremiumPerDay: Number(process.env.NEXT_PUBLIC_PRO_PREMIUM_PER_DAY || 30),
  /** Chain used for WalletConnect sessions (sign-in uses the chain the API returns). */
  siweChainId: Number(process.env.NEXT_PUBLIC_SIWE_CHAIN_ID || 1),
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  /** Token launch details (empty until launch). */
  dlynTokenAddress: process.env.NEXT_PUBLIC_DLYN_TOKEN_ADDRESS || "",
  dlynBuyUrl: process.env.NEXT_PUBLIC_DLYN_BUY_URL || "",
  dlynChartUrl: process.env.NEXT_PUBLIC_DLYN_CHART_URL || "",
  /** Block explorer base URL, e.g. https://basescan.org */
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL || "").replace(/\/$/, ""),
};
