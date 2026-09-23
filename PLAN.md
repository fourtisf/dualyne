# Refract — Build & Deployment Plan

Status: **Phase 1 built** (website + API + tests). Next: Phase 2 (deploy), which needs the domain and server details. See §11 for what shipped and §12 for what must happen before public launch.

Sources read in full: `docs/refract.html` (1,206 lines: CSS, markup, and the inline script for compare, wallet modal, leaderboard, docs/dashboard router) and `docs/HANDOFF.md`. Where they disagree with `CLAUDE_CODE_PROMPT.md`, the prompt wins (for example Docker instead of PM2). Open questions are listed in §10. Each one has a recommended default. If you reply "lanjut" without answering them, the defaults apply.

---

## 1. Phase map

The prompt and HANDOFF number their phases differently. This plan uses these numbers:

| Plan phase | Content                                                                                                            | Source                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **P1**     | Website in Next.js, all models live, `/v1/*`, `/internal/compare`, budget cap, request logging, model-id check job | Prompt Phase 1 = HANDOFF Phase 1 |
| **P2**     | Production deploy: Docker, Nginx, TLS, Cloudflare, CI/CD, backups, DEPLOY.md                                       | Prompt Phase 2                   |
| **P3**     | SIWE wallet sign-in, self-serve API keys, per-wallet quota, sybil check, real dashboard                            | HANDOFF Phase 2                  |
| **P4**     | On-chain RFX tier check, treasury jobs, `GET /treasury`, token section at launch                                   | HANDOFF Phase 3                  |
| **P5**     | Votes, community Elo leaderboard, Builder prepaid credit, optional x402                                            | HANDOFF Phase 4                  |

After every phase: lint, typecheck and tests pass, then a commit, then a short summary, then I stop and wait.

---

## 2. Folder structure

The monorepo uses **pnpm workspaces**. There's no Turborepo, because plain `pnpm -r` is enough at this size.

```
refract/
├─ apps/
│  ├─ web/                          Next.js 14, App Router, TypeScript
│  │  ├─ app/
│  │  │  ├─ layout.tsx              <html>, fonts, Nav, MobileNav, Footer, WalletModal
│  │  │  ├─ globals.css             prototype <style> block, copied verbatim
│  │  │  ├─ page.tsx                home: all sections of <main id="top">
│  │  │  ├─ docs/page.tsx           was #/docs
│  │  │  ├─ dashboard/page.tsx      was #/dashboard
│  │  │  └─ health/route.ts         GET /health → {status:"ok"}
│  │  ├─ components/                see §5
│  │  ├─ lib/
│  │  │  ├─ markdown.ts             prototype md()/inline()/esc(), ported 1:1
│  │  │  ├─ compare-client.ts       fetch + SSE reader for /internal/compare
│  │  │  ├─ storage.ts              the prototype's try/catch localStorage wrapper
│  │  │  └─ api.ts                  server-side fetch to the API (catalog)
│  │  ├─ public/                    favicon (the logo SVG)
│  │  ├─ next.config.mjs            output:"standalone", security headers
│  │  └─ Dockerfile
│  └─ api/                          Fastify 4, TypeScript, ESM
│     ├─ src/
│     │  ├─ server.ts               bootstrap and graceful shutdown
│     │  ├─ app.ts                  buildApp(): plugins and routes (used by tests)
│     │  ├─ env.ts                  zod-validated process.env; exits on bad config
│     │  ├─ plugins/                prisma, redis, cors, rate-limit, error handler, request-id
│     │  ├─ auth/apiKey.ts          Bearer rf_live_… → SHA-256 → ApiKey row
│     │  ├─ tiers.ts                tier rank, per-tier daily quota, max_tokens ceiling, key limit
│     │  ├─ quota.ts                Redis per-wallet daily counter
│     │  ├─ budget.ts               global daily spend cap (reserve → settle)
│     │  ├─ openrouter/
│     │  │  ├─ client.ts            undici fetch to OpenRouter; key only here
│     │  │  ├─ sse.ts               SSE line splitter and pass-through tee
│     │  │  └─ catalog.ts           GET /api/v1/models, pricing lookup
│     │  ├─ routes/
│     │  │  ├─ v1.chat.ts           POST /v1/chat/completions
│     │  │  ├─ v1.models.ts         GET  /v1/models
│     │  │  ├─ internal.compare.ts  POST /internal/compare
│     │  │  ├─ internal.catalog.ts  GET  /internal/catalog (public model list for the site)
│     │  │  └─ health.ts            GET  /health
│     │  ├─ jobs/
│     │  │  ├─ scheduler.ts         in-process cron with a Redis lock (single runner)
│     │  │  └─ verifyModels.ts      daily OpenRouter id check, refreshes prices, alerts
│     │  ├─ usage/log.ts            writes UsageLog rows
│     │  └─ turnstile.ts            Cloudflare siteverify
│     ├─ prisma/
│     │  ├─ schema.prisma
│     │  ├─ migrations/
│     │  └─ seed.ts                 upserts the models table
│     ├─ scripts/
│     │  ├─ create-key.ts           admin CLI: issue a test key for a wallet + tier (P1/P2)
│     │  └─ resolve-models.ts       prints current OpenRouter ids that match each family
│     ├─ test/                      vitest
│     └─ Dockerfile
├─ packages/
│  ├─ config/src/brand.ts           THE one brand file (name, symbol, domains, socials)
│  └─ shared/src/                   zod schemas and types shared by web and api
│                                   (compare request, SSE event shapes, tier names)
├─ deploy/
│  ├─ nginx/refract.conf            host Nginx site config (template)
│  ├─ backup/backup.sh              nightly pg_dump with 7-day retention
│  └─ scripts/deploy.sh             what CI runs on the server
├─ .github/workflows/
│  ├─ ci.yml                        lint, typecheck, test on every push/PR
│  └─ deploy.yml                    on push to main: test, then SSH deploy
├─ docker-compose.yml               local dev: postgres + redis (apps run with pnpm dev)
├─ docker-compose.prod.yml          web, api, migrate, postgres, redis, backup
├─ .env.example                     dev
├─ .env.production.example          prod, every variable commented
├─ .gitignore                       .env* except the *.example files
├─ DEPLOY.md
├─ PLAN.md
└─ docs/                            prototype + handoff (unchanged; the source of truth)
```

### Brand config: one file

`packages/config/src/brand.ts` is the only place that holds the name, symbol, domain and links:

```ts
export const brand = {
  name: "Refract",
  tokenSymbol: "RFX", // rendered as "$RFX" / "100,000 RFX"
  tokenName: "Refract access token",
  domain: "refract.dev", // site: https://{domain}, API: https://api.{domain}
  apiBaseUrl: "https://api.refract.dev/v1",
  keyPrefix: "rf_live_",
  social: { x: "#", telegram: "#", github: "#" },
  copyrightYear: 2026,
} as const;
```

Every "Refract", "$RFX", "RFX" and "api.refract.dev" in the site markup, code samples, docs, key prefix and API error messages is read from this file. The domains are overridable by env (`PUBLIC_DOMAIN`) so the same build can run on any domain. The source-code identifier `refract` (package names, DB name) stays as-is, because it isn't user-visible.

---

## 3. Prisma schema

Each table is introduced in the phase that needs it (one migration per phase). The full target is shown so the P1 design doesn't paint later phases into a corner.

```prisma
generator client { provider = "prisma-client-js" }
datasource db   { provider = "postgresql"; url = env("DATABASE_URL") }

enum Tier { explorer holder builder }

// ── P1 ────────────────────────────────────────────────────────────
model Model {
  id               String   @id              // Refract id: "claude-swift"
  name             String                    // "Claude Swift"
  provider         String                    // "Anthropic"
  providerColor    String                    // "#D4A27F" (catalog swatch)
  bestFor          String                    // "Quick answers, chat, summaries"
  speed            Int                       // 1–4 bars in the catalog
  openrouterId     String                    // "anthropic/claude-haiku-…"
  minTier          Tier
  sortOrder        Int
  enabled          Boolean  @default(true)
  // refreshed daily from OpenRouter's catalog; USD per token, as strings from OR
  promptPrice      Decimal  @db.Decimal(18, 12)
  completionPrice  Decimal  @db.Decimal(18, 12)
  contextLength    Int?
  lastVerifiedAt   DateTime?
  missingSince     DateTime?                 // set when the id vanished from OR
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  usage            UsageLog[]
}

model Wallet {
  id           String   @id @default(cuid())
  address      String   @unique              // lowercase 0x…
  tierOverride Tier?                         // P1/P2 admin-issued test keys; P4 uses on-chain
  createdAt    DateTime @default(now())
  keys         ApiKey[]
  usage        UsageLog[]
}

model ApiKey {
  id         String    @id @default(cuid())
  walletId   String
  wallet     Wallet    @relation(fields: [walletId], references: [id], onDelete: Cascade)
  hash       String    @unique               // hex SHA-256 of the full key
  last4      String
  name       String?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  usage      UsageLog[]
  @@index([walletId])
}
// Revoke = delete the row, which removes the hash (HANDOFF). UsageLog.apiKeyId → SetNull.

model UsageLog {
  id             BigInt   @id @default(autoincrement())
  createdAt      DateTime @default(now())
  source         String                     // "api" | "compare"
  apiKeyId       String?
  apiKey         ApiKey?  @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  walletId       String?
  wallet         Wallet?  @relation(fields: [walletId], references: [id], onDelete: SetNull)
  walletAddress  String?                    // denormalised, survives wallet deletion
  modelId        String
  model          Model    @relation(fields: [modelId], references: [id])
  openrouterId   String                     // exact upstream id used
  generationId   String?                    // OpenRouter gen id, for audits
  inputTokens    Int      @default(0)
  outputTokens   Int      @default(0)
  costMicroUsd   BigInt   @default(0)       // 1 = $0.000001
  latencyMs      Int                        // total
  ttftMs         Int?                       // time to first token
  status         Int                        // HTTP status we returned
  errorCode      String?
  stream         Boolean
  ipHash         String?                    // HMAC(IP) for compare rows; never the raw IP
  compareId      String?
  @@index([createdAt])
  @@index([walletId, createdAt])
  @@index([apiKeyId, createdAt])
}

model CompareRun {                           // one per /internal/compare call
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  modelA     String
  modelB     String
  ipHash     String
  completedA Boolean  @default(false)
  completedB Boolean  @default(false)
  // P5 votes reference this, so a vote needs a matching completed compare
}

// DailySpend was dropped during build: the day's spend is rebuilt from UsageLog when Redis loses it.

model ModelCheck {                           // history of the daily verification job
  id        String   @id @default(cuid())
  ranAt     DateTime @default(now())
  ok        Boolean
  missing   String[]                         // refract ids whose OR id vanished
  details   Json
}

// ── P3 ────────────────────────────────────────────────────────────
// SIWE nonces live in Redis (5 min TTL, single use), not in Postgres.
model Session {
  id        String   @id                      // random 32 bytes, stored hashed
  walletId  String
  createdAt DateTime @default(now())
  expiresAt DateTime
  @@index([walletId])
}

// ── P4 ────────────────────────────────────────────────────────────
model TreasuryDay {
  day           DateTime @id @db.Date
  inflowUsd     Decimal  @db.Decimal(18, 6)   // fees received (on-chain)
  outflowUsd    Decimal  @db.Decimal(18, 6)   // sum(UsageLog.cost) for the day
  balanceUsd    Decimal  @db.Decimal(18, 6)   // end-of-day balance
  txRefs        Json                          // tx hashes backing the inflow
}

// ── P5 ────────────────────────────────────────────────────────────
model Vote {
  id         String   @id @default(cuid())
  compareId  String   @unique                  // one vote per compare run
  modelA     String
  modelB     String
  winner     String                            // "a" | "b" | "tie"
  walletId   String?
  createdAt  DateTime @default(now())
}
model EloRating { modelId String @id; rating Float; wins Int; games Int; updatedAt DateTime @updatedAt }
model CreditAccount { walletId String @id; balanceMicroUsd BigInt @default(0); depositAddress String? @unique }
model Deposit { id String @id @default(cuid()); walletId String; chainId Int; txHash String @unique; asset String; amount Decimal @db.Decimal(38,18); usdValue Decimal @db.Decimal(18,6); createdAt DateTime @default(now()) }
```

Why money is stored in **micro-USD integers**: Redis `INCRBY` stays exact, there's no float drift in the budget cap, and one request can't overflow it.

---

## 4. API endpoints

Every body, query and param is validated with zod (`fastify-type-provider-zod`). Every public route has a rate limit (`@fastify/rate-limit`, Redis store). The client IP is taken from `CF-Connecting-IP`, but only after Nginx has verified that the connection came from a Cloudflare IP range (§7).

### P1

| Method | Path                   | Auth       | Rate limit                                                 | Notes                                                                      |
| ------ | ---------------------- | ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| POST   | `/v1/chat/completions` | Bearer key | 60/min per key + 120/min per IP                            | The steps are listed below                                                 |
| GET    | `/v1/models`           | Bearer key | 60/min per key                                             | OpenAI list shape, filtered to the caller's tier                           |
| POST   | `/internal/compare`    | Turnstile  | **10/hour per IP**, plus 30/min per IP on failed Turnstile | The steps are listed below                                                 |
| GET    | `/internal/catalog`    | none       | 120/min per IP, 60 s cache                                 | Public catalog rows for the website (name, provider, bestFor, speed, tier) |
| GET    | `/health`              | none       | 60/min per IP                                              | Checks DB `SELECT 1` and Redis `PING`: 200 or 503                          |

**`POST /v1/chat/completions`**

1. Parse the Bearer token. It must match `^rf_live_[0-9a-f]{32}$`, otherwise 401. SHA-256 it and look up `ApiKey.hash`. The lookup result is cached in Redis for 30 s, and a revoke busts the cache, so a revoke takes effect on the next request.
2. zod-validate the body. Known OpenAI fields are typed, and the schema is `passthrough()` so `tools`, `response_format` and so on pass through unchanged. `model` must be a Refract id (400 otherwise).
3. Tier check. `tier(wallet) ≥ model.minTier`, otherwise 403. In P1/P2 the tier is `Wallet.tierOverride ?? explorer`.
4. Clamp `max_tokens` (and `max_completion_tokens`) to the tier ceiling.
5. Budget. If the caller's tier is free and the cap has been hit, return 429 with `Retry-After` set to seconds until 00:00 UTC.
6. Quota. `INCR quota:{wallet}:{YYYY-MM-DD}` with 48 h expiry. If the count is over the tier limit, `DECR` and return 429. The response carries `x-refract-remaining`.
7. Proxy to OpenRouter with the model id swapped to `openrouterId`. The server-side `OPENROUTER_API_KEY` is added here and nowhere else.
8. **Streaming:** upstream bytes are written to the client exactly as received, including OpenRouter's `: OPENROUTER PROCESSING` keep-alive comments. A tee parses the same lines to catch TTFT and the final `usage` object. To get cost we send `usage:{include:true}` upstream. If the client did not ask for `stream_options.include_usage`, the one extra usage-only chunk that this adds is dropped, so the client receives what it would have received without it. Client disconnect aborts the upstream request.
9. The response `model` field is **not** rewritten: it reports the exact upstream model, so events pass through byte-for-byte (decision on Q7, see §10).
10. Settle. Record the real cost into the spend counter, write the UsageLog row (key id, wallet, model, input/output tokens, cost, latency, TTFT, status) and update `lastUsedAt`. If the upstream call fails, the quota is refunded and the error comes back as 502 in OpenAI error shape.

**`POST /internal/compare`**. One request covers one comparison run. That matters because Turnstile tokens are single-use and the 10/hour limit should count runs, not lanes.

- Body `{prompt: string(1..8000), a: modelId, b: modelId, turnstileToken: string}`.
- The Turnstile token is verified with siteverify. The hostname must equal the site domain.
- Both models must be `minTier = explorer`, otherwise 403. `max_tokens` is fixed at 1,000.
- If the budget cap has been hit, the response is 429.
- A `CompareRun` row is created, and both upstream streams run in parallel.
- The response is **one SSE stream** that multiplexes both lanes:
  ```
  event: meta   data: {"compareId":"…","a":"claude-swift","b":"llama"}
  event: delta  data: {"lane":"a","text":"An AMM is"}
  event: delta  data: {"lane":"b","text":"### The short"}
  event: done   data: {"lane":"a","ttftMs":412,"totalMs":1900,"outputTokens":96}
  event: error  data: {"lane":"b","code":"upstream_failed"}
  event: end    data: {}
  ```
  A 15 s `: ping` comment keeps Cloudflare and Nginx from timing out the connection.
- Each lane writes its own UsageLog row with `source="compare"`, `ipHash` and `compareId`.
- CORS allows only `https://{domain}`.

### P3: wallet accounts and keys

| Method | Path               | Notes                                                                                                                                                                                                    |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/auth/nonce`      | Random nonce stored in Redis (5 min TTL, single use)                                                                                                                                                     |
| POST   | `/auth/verify`     | `{message, signature}`. The SIWE message (EIP-4361) is verified with viem, including domain, URI, chainId, nonce and expiry. The response sets an `HttpOnly; Secure; SameSite=Lax` cookie on `.{domain}` |
| POST   | `/auth/logout`     |                                                                                                                                                                                                          |
| GET    | `/me`              | Wallet, tier, today's usage, remaining, key count and limit                                                                                                                                              |
| GET    | `/me/usage?days=7` | Daily request counts (days capped at 1..30)                                                                                                                                                              |
| GET    | `/me/keys`         | Key id, last4, created, lastUsed                                                                                                                                                                         |
| POST   | `/me/keys`         | Enforces the key limit per tier (1 / 5 / unlimited). Returns the full key **once**                                                                                                                       |
| DELETE | `/me/keys/:id`     | Deletes the row and busts the auth cache                                                                                                                                                                 |

The sybil gate for Explorer is `balance ≥ SYBIL_MIN_ETH_WEI` **or** first tx older than `SYBIL_MIN_WALLET_AGE_DAYS`. It's read via viem and cached for 24 h. There's one caveat: wallet age needs an indexer or explorer API, because a plain RPC can't answer it. See Q8.

### P4: token and treasury

`GET /treasury` returns balance, runway (balance ÷ 7-day average spend), the 30-day balance series and daily in/out rows. RFX balance is read with viem `balanceOf`, cached for 5 min in `tier:{address}`.

### P5: votes, leaderboard, credit

`POST /votes`, `GET /leaderboard` (nightly Elo, K=24, start at 1000, same-model votes ignored), then Builder credit accounts, a deposit watcher, and charges at cost × 1.15.

---

## 5. How `refract.html` splits into React

**Rule: identical DOM and CSS.** The whole `<style>` block moves into `app/globals.css` **unchanged**, including the v4/v5/v6 override layers. That preserves the cascade order and avoids subtle visual drift. Components emit the same tags, class names, ids and attributes as the prototype. After P1 I'll take Playwright screenshots of the prototype and the Next.js build side by side at 1440/820/390 px, and diff them. The two builds should differ only where §5.3 deliberately changes something.

Fonts are the Geist and Geist Mono weights the prototype loads, served through `next/font/google` (self-hosted, same files). `--sans` and `--mono` are pointed at the next/font family variables, so nothing else in the CSS changes.

### 5.1 Components

| Component        | Prototype source                                                 | Server/Client                                      |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `Logo`           | `<svg class="logo">` with the `#lg` gradient                     | server                                             |
| `Nav`            | `header.nav` (links, Dashboard link, wallet button, menu button) | client (wallet label, menu toggle)                 |
| `MobileNav`      | `nav.mnav`                                                       | client                                             |
| `Hero`           | `.hero-text` (badge, h1, lede, CTAs, trust row)                  | server, with `WalletButton` islands                |
| `CompareConsole` | `#compare .console` (bar, composer, chips, lanes, verdict)       | client                                             |
| ├ `Lane`         | `.lane[data-lane]` with `select`, `.stats`, `.lb`                | client                                             |
| └ `Verdict`      | `#verdict` (Left / About the same / Right, record)               | client                                             |
| `LogoMarquee`    | `section.logos`                                                  | server                                             |
| `Features`       | `#features` bento: race, keycard, mini code, spark               | server + `TileSpotlight` (pointermove `--mx/--my`) |
| `Models`         | `#models`, with `.mtabs` Catalog/Leaderboard toggle              | client (tab state)                                 |
| ├ `ModelCatalog` | `#mt-cat` table rows, **rendered from `/internal/catalog`**      | server data                                        |
| └ `Leaderboard`  | `#leaderboard` (local "Your votes" Elo)                          | client                                             |
| `ApiSection`     | `#api` list + code tabs + Copy                                   | client (tabs)                                      |
| `Pricing`        | `#pricing` tiers + fine print                                    | server                                             |
| `Token`          | `#token` coin, facts, contract row, fee split                    | server                                             |
| `Treasury`       | `.subhead` + `#ledger`, with the count-up KPIs                   | client (IntersectionObserver)                      |
| `Faq`            | `#faq` `<details>`                                               | server                                             |
| `Closing`        | `section.closing`                                                | server                                             |
| `Footer`         | `footer.big` (socials from `brand.social`)                       | server                                             |
| `WalletModal`    | `dialog#walletModal` (connect / access / keys)                   | client, context provider                           |
| `DocsView`       | `#view-docs` TOC + prose (`/docs`)                               | server + a small client TOC scroller               |
| `DashboardView`  | `#view-dash` gate + cards + bars (`/dashboard`)                  | client                                             |

Shared client state (the wallet and the local vote/usage history) lives in a `WalletProvider` context in `layout.tsx`. It reads and writes the same `localStorage` keys as the prototype (`refract.wallet`, `refract.matches`, `refract.usage`, `refract.hist`).

### 5.2 Routing

| Prototype                                  | Next.js                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `#/docs`                                   | `/docs`                                                                     |
| `#/dashboard`                              | `/dashboard`                                                                |
| `#features`, `#models`, … on the home page | unchanged; from `/docs` and `/dashboard` they become `/#features` and so on |
| `data-doc` TOC links                       | `href="#d-quick"` etc. with the same smooth-scroll behaviour                |

Old hash links such as `/#/docs` get a tiny client redirect so shared URLs keep working.

### 5.3 Deliberate differences from the prototype

Each of these is required by the prompt or HANDOFF. The exact new copy is in Q3.

1. The `sample(...)` path, `window.claude.use` and the "Connecting to models…" / "needs model access from the claude.ai viewer" messages are replaced by `compare-client.ts`, which POSTs to `/internal/compare` and reads the multiplexed SSE. The lane rendering (`shim`, `caret`, `md()`, stats, error text) is unchanged.
2. **Turnstile** is added. It's an invisible/managed widget that runs when you click "Run comparison". There's no visible box unless Cloudflare decides to challenge.
3. **Every model is marked live.** The model dropdowns, the "3 models live" counter, the catalog Status column, the FAQ answer and the footer line are updated to match.
4. The example run shown on first load (`EX_A`/`EX_B`) stays. It's already labelled "Example run" and disappears on the first real run.
5. The Stop button aborts the single fetch.
6. Error messages map to the new server codes: `rate_limited` becomes the existing "Too many runs…" text, and `budget` gets a new message (Q3).

The Treasury KPIs, chart and table keep their **"Sample data"** label, and the fee split keeps **"Proposal"**, until P4. The pricing fine print stays too.

---

## 6. Environment variables

`.env.example` (dev) and `.env.production.example` (prod) list the same keys. Every line in the prod file gets a comment.

| Variable                                                                          | Used by       | Example / default                                                                 | Phase |
| --------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------- | ----- |
| `NODE_ENV`                                                                        | both          | `production`                                                                      | P1    |
| `PUBLIC_DOMAIN`                                                                   | both          | `refract.dev` (the site is `https://{d}`, the API is `https://api.{d}`)           | P1    |
| `NEXT_PUBLIC_API_URL`                                                             | web (browser) | `https://api.refract.dev`                                                         | P1    |
| `API_INTERNAL_URL`                                                                | web (server)  | `http://api:4000`                                                                 | P1    |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                                                  | web           | Cloudflare dashboard                                                              | P1    |
| `TURNSTILE_SECRET_KEY`                                                            | api           | Cloudflare dashboard (**secret**)                                                 | P1    |
| `OPENROUTER_API_KEY`                                                              | api           | `sk-or-…` (**secret**, server only)                                               | P1    |
| `OPENROUTER_BASE_URL`                                                             | api           | `https://openrouter.ai/api/v1`                                                    | P1    |
| `OPENROUTER_APP_URL` / `OPENROUTER_APP_TITLE`                                     | api           | sent as `HTTP-Referer` / `X-Title`                                                | P1    |
| `DATABASE_URL`                                                                    | api           | `postgresql://refract:…@postgres:5432/refract` (**secret**)                       | P1    |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`                             | postgres      | (**secret** password)                                                             | P1    |
| `REDIS_URL`                                                                       | api           | `redis://:pass@redis:6379`                                                        | P1    |
| `REDIS_PASSWORD`                                                                  | redis         | (**secret**)                                                                      | P1    |
| `DAILY_BUDGET_USD`                                                                | api           | `100`                                                                             | P1    |
| `COMPARE_LIMIT_PER_HOUR`                                                          | api           | `10`                                                                              | P1    |
| `COMPARE_MAX_TOKENS`                                                              | api           | `1000`                                                                            | P1    |
| `TIER_EXPLORER_DAILY` / `TIER_HOLDER_DAILY`                                       | api           | `20` / `250`                                                                      | P1    |
| `TIER_EXPLORER_MAX_TOKENS` / `TIER_HOLDER_MAX_TOKENS` / `TIER_BUILDER_MAX_TOKENS` | api           | see Q5                                                                            | P1    |
| `IP_HASH_SECRET`                                                                  | api           | 32 random bytes (**secret**), used for HMAC of IPs                                | P1    |
| `ALERT_WEBHOOK_URL`                                                               | api           | optional Discord/Slack/Telegram-compatible webhook for model-id and budget alerts | P1    |
| `LOG_LEVEL`                                                                       | api           | `info`                                                                            | P1    |
| `API_PORT` / `WEB_PORT`                                                           | both          | `4000` / `3000` (bound to 127.0.0.1 in prod)                                      | P2    |
| `BACKUP_DIR` / `BACKUP_RETENTION_DAYS`                                            | backup        | `/var/backups/refract` / `7`                                                      | P2    |
| `SESSION_SECRET`                                                                  | api           | (**secret**)                                                                      | P3    |
| `SIWE_CHAIN_ID`                                                                   | both          | see Q9                                                                            | P3    |
| `RPC_URL`                                                                         | api           | chain RPC (**secret** if it's keyed)                                              | P3    |
| `SYBIL_MIN_ETH_WEI` / `SYBIL_MIN_WALLET_AGE_DAYS`                                 | api           | configurable                                                                      | P3    |
| `EXPLORER_API_URL` / `EXPLORER_API_KEY`                                           | api           | wallet-age lookup (Q8)                                                            | P3    |
| `RFX_TOKEN_ADDRESS` / `HOLDER_MIN_RFX`                                            | api           | set at launch / `100000`                                                          | P4    |
| `TREASURY_WALLET_ADDRESS`                                                         | api           | fee wallet                                                                        | P4    |
| `USDG_TOKEN_ADDRESS` / `BUILDER_MARKUP`                                           | api           | – / `1.15`                                                                        | P5    |

CI-only secrets in GitHub are `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_PATH`. Application secrets are **not** stored in GitHub. They live only in `/opt/refract/.env` on the server.

---

## 7. Deployment plan (P2)

**Target:** one Ubuntu 22.04/24.04 VPS (2 vCPU, 4 GB RAM minimum), Docker Engine and the Compose plugin, host Nginx and certbot, with Cloudflare in front.

```
Browser ──HTTPS──▶ Cloudflare (proxied, SSL "Full (strict)")
                       │  HTTPS (Let's Encrypt cert on origin)
                       ▼
                 VPS :443  Nginx (host)   ── firewall allows 80/443 from Cloudflare IPs only, 22 from anywhere
                   ├─ domain.com, www → 127.0.0.1:3000  web container
                   └─ api.domain.com  → 127.0.0.1:4000  api container
                                           │ docker network "internal" (no published ports)
                                           ├─ postgres:16 (volume pgdata)
                                           └─ redis:7 (password, AOF, volume redisdata)
```

- **Dockerfiles.** Both are multi-stage (deps → build → runtime) on `node:20-alpine` and run as a non-root `node` user. The web image uses Next `output: "standalone"`. The api image is the compiled JS plus the Prisma client. Each has a `HEALTHCHECK` that hits `/health`.
- **`docker-compose.prod.yml`.** Services are `web`, `api`, `migrate` (a one-shot `prisma migrate deploy`; `api` depends on it with `service_completed_successfully`), `postgres`, `redis` and `backup`. All of them use `restart: unless-stopped`. Only web and api publish ports, and only on `127.0.0.1`. Postgres and Redis publish **none**. Images are tagged with the git SHA so a rollback doesn't need a rebuild.
- **Nginx.** The config does three things:
  - HTTP → HTTPS redirect.
  - `real_ip_header CF-Connecting-IP` with `set_real_ip_from` for each Cloudflare range. The range list comes from a script that refreshes it weekly.
  - The API location gets `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 300s`, `proxy_http_version 1.1`, `Connection ""` and `X-Accel-Buffering: no`, so SSE streams through untouched. The API also sends `Cache-Control: no-cache, no-transform`, so Cloudflare doesn't buffer or compress the stream.
- **TLS.** With Cloudflare proxying, the HTTP-01 challenge is unreliable because Cloudflare's "Always Use HTTPS" gets in the way. So certbot uses the **DNS-01** challenge via `python3-certbot-dns-cloudflare`, with a Cloudflare API token scoped to _Zone:DNS:Edit_ on this zone only. Certbot's systemd timer renews automatically, and a deploy hook reloads Nginx. See Q2 for an alternative.
- **Cloudflare DNS records.** `DEPLOY.md` gives exact screenshots-in-words:
  | Type | Name | Content | Proxy |
  |---|---|---|---|
  | A | `@` | server IPv4 | Proxied |
  | A | `www` | server IPv4 | Proxied |
  | A | `api` | server IPv4 | Proxied |
  | AAAA | same three | server IPv6 (only if the server has one) | Proxied |

  The Cloudflare settings are SSL/TLS "Full (strict)", Always Use HTTPS on, and Rocket Loader off, because it breaks Next.js hydration. A cache rule bypasses the cache for `api.*`. Turnstile gets a site created for the domain.

- **Migrations** run automatically on every deploy through the `migrate` service. They're forward-only. Schema changes follow expand/contract so the previous image still works during a rollback.
- **Health.** `GET /health` exists on both services and is used by the Docker healthchecks and by the deploy script's post-deploy check.
- **Backups.** The `backup` container (postgres:16-alpine plus a tiny loop script) runs `pg_dump -Fc` nightly at 03:00 UTC into the host's `/var/backups/refract/refract-YYYY-MM-DD.dump` and deletes files older than 7 days. `DEPLOY.md` covers the restore command and an optional off-server copy (rclone to any S3 bucket).
- **CI/CD.**
  - `ci.yml` runs on every push and PR: pnpm install, lint, typecheck, and tests with Postgres and Redis service containers.
  - `deploy.yml` runs on push to `main`: the same test job, then an SSH step with `appleboy/ssh-action` that runs `deploy/scripts/deploy.sh`. That script does `git fetch && git reset --hard origin/main`, `docker compose build` (tagged by SHA), `docker compose up -d` (migrate runs first), waits until `/health` on both services is 200, and prunes images older than the last 5 SHAs.
  - If the health check fails, the script automatically redeploys the previous SHA and the job fails red.
  - A concurrency group prevents overlapping deploys.
- **Rollback.** Run `deploy/scripts/deploy.sh --rollback <sha>`, or just `git revert` on main and push. `DEPLOY.md` explains both in plain steps.
- **Server hardening,** covered in `DEPLOY.md`: a non-root deploy user, SSH key only, `ufw` (22 plus 80/443), unattended-upgrades, and a Docker log-rotation config.
- The production server is never destroyed: no `down -v`, no `DROP`. The deploy script never touches volumes, and I'll ask before any such command.

**Definition of done for P2:** `https://domain.com` loads, a comparison streams live, `curl https://api.domain.com/v1/chat/completions -H "Authorization: Bearer <test key>"` works, and a push to `main` redeploys. The test key is issued with `scripts/create-key.ts` on the server, because self-serve keys only arrive in P3.

---

## 8. Tests (vitest)

The API tests use `buildApp()` with `fastify.inject()`, real Postgres and Redis (docker locally, service containers in CI), and a **test-only** fake OpenRouter HTTP server that streams scripted SSE. There's no mock data in production code.

| Area (required by the prompt) | Cases                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key auth                      | missing key → 401; malformed → 401; unknown hash → 401; valid → 200; revoked (row deleted) → 401 on the very next request (cache bust); only the hash is stored                                                                                  |
| Tier check                    | explorer → holder model = 403; holder → holder model = 200; `/v1/models` filtered by tier; compare rejects non-explorer models                                                                                                                   |
| Quota counting                | the Nth request passes and the N+1th gets 429; `x-refract-remaining` counts down; key expires in 48 h; an upstream failure refunds the quota; concurrent requests don't overshoot                                                                |
| Budget cap                    | spend ≥ cap → free tiers 429 with a `Retry-After` to 00:00 UTC; builder still allowed; the cap resets on a UTC date change (fake clock); reservation prevents overshoot under concurrency                                                        |
| SSE streaming                 | pass-through is byte-identical to upstream (fixture comparison, including keep-alive comments); `model` rewritten; the usage chunk is dropped unless requested; client abort cancels upstream; the compare multiplexer emits correct lane events |

There are also unit tests for `markdown.ts` (ported `md()`), the compare stream parser, the zod schemas and the Turnstile verification. The browser flow (home, `/docs`, `/dashboard`, the compare happy path against a fake upstream) was checked with Playwright during Phase 1. It is not yet part of CI; adding it is a Phase 2 task.

Tooling is ESLint (`next/core-web-vitals` plus `@typescript-eslint`), Prettier and `tsc --noEmit`. The root scripts are `pnpm lint`, `pnpm typecheck` and `pnpm test`.

---

## 9. Security checklist (hard rules → where enforced)

- **The OpenRouter key never leaves the api container.** It's read only in `openrouter/client.ts`. Pino redaction covers `authorization`, `*.apiKey`, `OPENROUTER_API_KEY` and `cookie`. The key is never in the web image, the browser or git.
- **API keys are stored as SHA-256 hashes plus last4.** The full key appears once in the create response.
- **Every request body is validated with zod,** and every public endpoint has a rate limit (§4).
- **`.env*` is gitignored,** except `.env.example` and `.env.production.example`.
- **Brand values live only in `packages/config/src/brand.ts`.**
- **The "Sample data" and "Proposal" labels stay** until P4/P5 supply real data.
- **Security headers:** HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and a CSP that allows Turnstile, Google Fonts (self-hosted anyway) and the API origin.
- **Raw client IPs are never stored.** Only an HMAC of the IP is kept.

---

## 10. Decisions (approved defaults, applied in Phase 1)

1. **Compare vs. "GPT vs Claude":** option A. Compare offers only Explorer models (Claude Swift, Llama, DeepSeek, Mistral). Holder models appear disabled under "With an API key". Default lanes: Claude Swift vs Meta Llama. GPT is verified through `/v1/chat/completions` with a Holder test key.
2. **TLS:** Let's Encrypt with the DNS-01 challenge (applies in Phase 2).
3. **Copy changes:** applied as proposed ("{n} models live", "Live" status, "Free to compare" / "With an API key", new FAQ and footer lines, budget message).
4. **Mistral:** added as the 8th model (Explorer).
5. **max_tokens ceilings:** Explorer 1,000, Holder 4,000, Builder none. Configurable by env.
6. **Wallet modal before sign-in:** Demo wallet removed. Connecting only reads the address (no signature until real SIWE). "Create key" is disabled with a "coming soon" note.
7. **Upstream model id:** changed from the draft. Responses report the real upstream id, and nothing inside stream chunks is rewritten. This keeps "SSE passed through unchanged" literally true and matches the transparency fix below (the catalog shows what each id runs on).
   8–10. Still open: the sybil indexer (Phase 3), the chain (Phase 3), and deploy target details (Phase 2).

Improvements added from the product review ("website ini kurang apa"):

- The Treasury section is labelled "Sample data" as a whole, not only its chart.
- Terms of Service and Privacy Policy pages, plus a token disclaimer under the Token section and in the Terms.
- A FAQ entry on what happens to prompts (text is never stored) and one on "why not OpenRouter directly".
- Social icons render only when a real link is set in `brand.ts` (no dead `#` links), and an optional contact email.
- The catalog shows the model each id runs on, context length, provider price per 1M tokens, tier and live status (from the daily sync).
- Compare shows the cost of each run, has a Copy button per answer, reports how many free runs are left, and gives clear messages for rate-limit, budget and verification errors.
- Docs gained the error JSON format, a 404 row, `Retry-After`, tier `max_tokens` caps, a streaming curl example, notes on tools/JSON mode, and the model version policy.
- SEO: metadata, Open Graph image, favicon, sitemap and robots.txt, plus real routes for `/docs` (old `#/docs` links redirect).
- Accessibility: `--faint` text raised from 2.8:1 to 4.8:1 contrast, a live region that announces when answers finish, and valid tab ARIA.
- A mobile layout bug inherited from the prototype is fixed: glow effects widened the home page to ~745px, so phones zoomed out.
- 404 and error pages in the site's style, and security headers (CSP, HSTS, frame-ancestors).
- The wallet error message explains what to do on phones (open the page in the wallet app's browser).

**Environment note:** this build sandbox can't reach `openrouter.ai`, because the network policy returns 403. So the exact OpenRouter ids (for example which `anthropic/claude-haiku-*` is current) can't be pinned here. In P1 the seed uses the newest ids I can confirm. Then `scripts/resolve-models.ts` and the daily verification job, running on the server, print and verify the live ids, and `/health` reports any mapped id that's missing. Tests use the fake upstream, so CI doesn't depend on OpenRouter.

---

## 11. Phase 1 status

- [x] pnpm monorepo, lint/typecheck/test/format scripts, `.gitignore`, `.env.example`, local `docker-compose.yml`
- [x] `packages/config` brand file and `packages/shared` (catalog, tiers, zod schemas)
- [x] Next.js site: prototype converted with the same DOM/CSS, `/docs`, `/dashboard`, `/terms`, `/privacy`, `/health`, 404. Checked side by side with the prototype at 1440 and 390 px.
- [x] Fastify API: `/v1/chat/completions` (stream and non-stream), `/v1/models`, `/internal/compare`, `/internal/catalog`, `/health`
- [x] Prisma schema, initial migration and models seed
- [x] Budget cap (reserve/settle), per-tier `max_tokens`, per-wallet quota, per-request usage log
- [x] Daily OpenRouter id check with a webhook alert; `models:resolve` to update the mapping
- [x] `key:create` admin script for test keys
- [x] 65 tests (API 55, web 5, shared 5) on real Postgres and Redis, plus a GitHub Actions CI workflow
- [x] Browser end-to-end run (Playwright): compare streaming, Stop, voting, leaderboard, wallet states, dashboard, docs, mobile menu, and old-link redirects, with no console errors

Known limits of this sandbox: `openrouter.ai` and `challenges.cloudflare.com` are blocked here. The end-to-end run used a local stand-in for OpenRouter, and Turnstile was checked through the API tests with a fake verifier. Both must be checked for real on the server in Phase 2.

## 11b. Phase 2 status (deploy)

- [x] Multi-stage Dockerfiles for web and API, running as the non-root `node` user, with healthchecks
- [x] `docker-compose.prod.yml`: postgres, redis (password, AOF), a one-shot `migrate` step (migrations + catalog seed), api, web and a nightly `backup`. Postgres and Redis publish no ports; web and api listen on 127.0.0.1 only.
- [x] Nginx template: HTTP→HTTPS, www→apex, Cloudflare real IP, SSE-safe API proxy (buffering off, 300 s timeouts). Passes `nginx -t`.
- [x] `server-setup.sh`: Docker, Nginx, certbot with the Cloudflare DNS challenge and auto-renewal, ufw (web ports only from Cloudflare, refreshed weekly), deploy user, repo deploy key
- [x] `deploy.sh`: build tagged by commit, migrate, health-check, automatic rollback, manual `--rollback`, and keeps the last 5 images
- [x] Nightly `pg_dump` with 7-day retention, plus `restore.sh`
- [x] GitHub Actions: CI also builds both images; Deploy runs after CI succeeds on `main` (SSH)
- [x] `.env.production.example` and `DEPLOY.md` (Indonesian, step by step)

Rehearsed in the sandbox with Docker:

- Images build and the whole stack comes up healthy.
- The site renders live catalog prices from the API container.
- A broken release rolls back automatically, and `--rollback` works.
- Backup → delete → restore round-trips.

Still untested: `server-setup.sh` on a real Ubuntu host (the sandbox has no systemd and no apt access), certbot, and Cloudflare.

## 11c. Phase 3 status (wallet accounts and keys)

- [x] Sign-In With Ethereum: `GET /auth/nonce`, `POST /auth/verify`, `GET /auth/session`, `POST /auth/logout`. Nonces are single use and last 5 minutes. The server checks the domain, URI, chain and message age, and the signature (smart-contract wallets too, when `RPC_URL` is set).
- [x] Sessions: a random `rf_session` cookie (HttpOnly, SameSite=Lax, Secure in production) valid for 30 days. Only its HMAC is stored, and a daily job purges expired sessions.
- [x] `GET /me`, `GET /me/usage?days=7` (per day and per key), `GET /me/keys`, `POST /me/keys` (the full key is shown once), `DELETE /me/keys/:id`
- [x] Key limits per tier (Explorer 1, Holder 5, Builder unlimited), with a per-wallet lock against parallel creation
- [x] CSRF: cookie writes require the website's `Origin`; credentialed CORS is only allowed for our origins
- [x] Sybil check for Explorer keys: minimum native balance **or** wallet age via an Etherscan-compatible API. Cached for a day when eligible; a cached refusal is re-checked when the user asks for a key.
- [x] Website: real sign-in with a browser wallet (WalletConnect when a project id is set), a key dialog (create, show once, copy, revoke with confirmation), and a dashboard on real data (requests today, tier, keys, a 7-day chart, usage per key)
- [x] Tests: 21 new API tests (SIWE rules, sessions, keys, limits, sybil, CSRF, CORS, scheduler) and a browser run of the full key lifecycle

## 12. Before public launch

- **Model ids:** on the server, run `pnpm --filter @refract/api models:resolve` and confirm or update each OpenRouter id. The seed ids (Claude Haiku/Sonnet/Opus 4.5, GPT-5, Gemini 2.5 Pro, Llama 3.3 70B, DeepSeek V3.1, Mistral Small 3.2) could not be verified from the sandbox.
- **Legal:** have a lawyer review `/terms` and `/privacy`, including governing law and the legal entity name (`brand.legalName`), and the token disclaimer.
- **Brand:** set the final name, domain, social links and `contactEmail` in `packages/config/src/brand.ts`.
- **Wallets:** WalletConnect is built in but only switches on with `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free at cloud.reown.com). It could not be tested from the sandbox, so test it once on the real domain.
- **Terms of resale:** read OpenRouter's and each provider's terms on reselling access (from HANDOFF).
- **Load test:** load-test `/internal/compare` and confirm the budget cap trips (from HANDOFF).
- **Not done, needs your decision:** an Indonesian (or other) language version, and sharing compare results by link. Sharing means storing answers, which changes the privacy promise.
