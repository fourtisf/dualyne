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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const required: [keyof typeof env, number][] = [
      ["OPENROUTER_API_KEY", 10],
      ["TURNSTILE_SECRET_KEY", 10],
      ["IP_HASH_SECRET", 32],
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

export function webOrigins(env: Env): string[] {
  if (env.WEB_ORIGINS) {
    return env.WEB_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [`https://${env.SITE_DOMAIN}`, `https://www.${env.SITE_DOMAIN}`];
}
