import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const optionalInt = z.coerce.number().int().positive().optional();

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SITE_DOMAIN: z.string().min(1).default("refract.dev"),
    /** Comma-separated origins allowed to call /internal/compare. Defaults to https://{SITE_DOMAIN} and www. */
    WEB_ORIGINS: z.string().optional(),
    /** Set to true only when the API sits behind the Nginx config in deploy/ (it overwrites X-Forwarded-For). */
    TRUST_PROXY: bool.default("false"),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
    OPENROUTER_APP_TITLE: z.string().default("Refract"),

    TURNSTILE_SECRET_KEY: z.string().default(""),
    TURNSTILE_VERIFY_URL: z
      .string()
      .url()
      .default("https://challenges.cloudflare.com/turnstile/v0/siteverify"),

    DAILY_BUDGET_USD: z.coerce.number().positive().default(100),
    COMPARE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
    COMPARE_MAX_TOKENS: z.coerce.number().int().positive().default(1000),
    TIER_EXPLORER_DAILY: optionalInt,
    TIER_HOLDER_DAILY: optionalInt,
    TIER_EXPLORER_MAX_TOKENS: optionalInt,
    TIER_HOLDER_MAX_TOKENS: optionalInt,
    TIER_BUILDER_MAX_TOKENS: optionalInt,

    IP_HASH_SECRET: z.string().default(""),
    ALERT_WEBHOOK_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    JOBS_ENABLED: bool.default("true"),

    // Wallet sign-in (SIWE) and on-chain reads
    SESSION_SECRET: z.string().default(""),
    SIWE_CHAIN_ID: z.coerce.number().int().positive().default(1),
    /** JSON-RPC endpoint for SIWE_CHAIN_ID. Without it, on-chain features are off. */
    RPC_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** auto = on when RPC_URL is set. */
    SYBIL_CHECK: z.enum(["auto", "on", "off"]).default("auto"),
    SYBIL_MIN_ETH_WEI: z
      .string()
      .regex(/^\d+$/)
      .default("1000000000000000")
      .transform((v) => BigInt(v)),
    SYBIL_MIN_WALLET_AGE_DAYS: z.coerce.number().int().min(0).default(30),
    /** Etherscan-compatible API (v2: https://api.etherscan.io/v2/api) used for wallet age. */
    EXPLORER_API_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    EXPLORER_API_KEY: z.string().default(""),

    // Token tier and treasury (Phase 4)
    RFX_TOKEN_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    HOLDER_MIN_RFX: z.coerce.number().positive().default(100_000),
    TREASURY_WALLET_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** Stablecoin (USDG) held by the treasury and used for Builder top-ups. 1 token = $1. */
    USDG_TOKEN_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** First block to scan for treasury inflows. Default: the last ~10,000 blocks. */
    TREASURY_START_BLOCK: z.coerce.number().int().min(0).optional(),
    CHAIN_CONFIRMATIONS: z.coerce.number().int().min(0).default(3),

    // Community leaderboard and Builder credits (Phase 5)
    /** optional = people pick models (blind is a choice); always = every run is blind (anti-manipulation). */
    COMPARE_BLIND_MODE: z.enum(["optional", "always"]).default("optional"),
    /** Votes are accepted this long after a comparison finished. */
    VOTE_WINDOW_HOURS: z.coerce.number().positive().default(24),
    /** Address that receives Builder top-ups. Without it, credits are off. */
    DEPOSIT_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** Chainlink ETH/USD feed on SIWE_CHAIN_ID; without it only USDG top-ups are accepted. */
    ETH_USD_FEED_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    BUILDER_MARKUP: z.coerce.number().min(1).max(10).default(1.15),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const required: [keyof typeof env, number][] = [
      ["OPENROUTER_API_KEY", 10],
      ["TURNSTILE_SECRET_KEY", 10],
      ["IP_HASH_SECRET", 32],
      ["SESSION_SECRET", 32],
    ];
    for (const [key, min] of required) {
      const v = env[key];
      if (typeof v !== "string" || v.length < min) {
        ctx.addIssue({ code: "custom", path: [key], message: `required in production (min ${min} chars)` });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}

/** Hosts (host[:port]) of the allowed web origins, used as the SIWE `domain`. */
export function webHosts(env: Env): string[] {
  return webOrigins(env).map((o) => new URL(o).host);
}

export function webOrigins(env: Env): string[] {
  if (env.WEB_ORIGINS) {
    return env.WEB_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [`https://${env.SITE_DOMAIN}`, `https://www.${env.SITE_DOMAIN}`];
}
