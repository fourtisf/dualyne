# Refract — Production Handoff

The front-end prototype (`refract.html`) is complete. This document covers everything needed to turn it into a live product. Work in the phase order below; each phase ships something usable.

## Stack

Next.js 14 (front end), Fastify (API), Prisma + PostgreSQL (data), Redis (rate limits, counters), OpenRouter (model provider). Deploy behind Nginx with PM2 or any Node host. Cloudflare in front for TLS, caching and Turnstile.

## Phase 1 — All models live (highest priority)

Goal: the Compare tool and the API serve GPT, Gemini, Llama, DeepSeek and the rest, not only Claude.

**Model router**
- One OpenRouter key, stored only on the server (`OPENROUTER_API_KEY`). Never shipped to the browser.
- A `models` table maps Refract ids to OpenRouter ids, tier, and price:

| Refract id | OpenRouter id (check current catalog) | Min tier |
|---|---|---|
| claude-swift | anthropic/claude-haiku-* | explorer |
| claude-balanced | anthropic/claude-sonnet-* | holder |
| claude-deep | anthropic/claude-opus-* | holder |
| gpt | openai/gpt-* | holder |
| gemini | google/gemini-* | holder |
| llama | meta-llama/llama-* | explorer |
| deepseek | deepseek/deepseek-* | explorer |

Model ids change often. Pull `GET https://openrouter.ai/api/v1/models` daily and alert when a mapped id disappears.

**Endpoints (OpenAI-compatible)**
- `POST /v1/chat/completions` — validate key → check tier allows model → check quota → proxy to OpenRouter → stream back unchanged (SSE) → log usage.
- `GET /v1/models` — models visible to the caller's tier.
- `POST /internal/compare` — used by the website's Compare tool. No key; protected by Cloudflare Turnstile + per-IP limit (10/hour) + explorer-tier models only + `max_tokens` capped at 1,000.

**Front-end change**: in `refract.html`, replace the `sample(...)` call in `runLane()` with a `fetch` to `/internal/compare` reading the SSE stream; mark every model `live: true`.

**Safety rails (must ship with Phase 1)**
- Global daily spend cap (`DAILY_BUDGET_USD`, start at 100). When hit, free tiers return 429 until 00:00 UTC. Paid Builder requests keep working.
- `max_tokens` ceiling per tier.
- Log every request: key id, wallet, model, input tokens, output tokens, cost, latency, status.

## Phase 2 — Wallet accounts and keys

- Sign-In With Ethereum (EIP-4361). Server issues a nonce, wallet signs, server verifies and sets a session cookie.
- API keys: generate `rf_live_` + 32 random hex chars. Store **only a SHA-256 hash** plus the last 4 chars. Show the full key once.
- Revoke = delete the hash; takes effect on the next request.
- Key limits per tier: Explorer 1, Holder 5, Builder unlimited.
- Quota in Redis: `quota:{wallet}:{YYYY-MM-DD}` with 48h expiry. Response header `x-refract-remaining`.
- Sybil control: Explorer tier requires the wallet to hold a minimum ETH balance or be older than N days (configurable).
- Dashboard (`#/dashboard` in the prototype) reads from `GET /me`, `GET /me/usage?days=7`, `GET /me/keys`, `POST /me/keys`, `DELETE /me/keys/:id`.

## Phase 3 — Token, tiers and treasury

- Tier check: read the wallet's RFX balance on-chain (cache 5 minutes in Redis). ≥ 100,000 → Holder.
- Treasury: fee wallet receives the 1% trade fee. A daily job records inflow (on-chain), converts to stable, tops up OpenRouter credit, and records outflow (sum of `cost` from the usage log).
- `GET /treasury` returns balance, runway (balance ÷ 7-day average spend), 30-day balance series, and daily in/out rows. The Treasury section replaces its sample data with this and drops the "Sample data" label.
- Token section: fill in the contract address and enable Buy / View chart links at launch.

## Phase 4 — Community leaderboard and payments

- `POST /votes` `{a, b, winner: "a"|"b"|"tie", compareId}` — one vote per compare run, tied to the Turnstile session or wallet. Reject votes without a matching completed compare.
- Nightly Elo recompute (K=24, start 1000) → `GET /leaderboard`. Enable the "Everyone" toggle in the leaderboard.
- Anti-manipulation: ignore votes where both lanes were the same model; hide model names until after voting if manipulation appears.
- Builder tier: prepaid credit balance per wallet, topped up in USDG or ETH (watch deposits to a per-wallet or memo-tagged address). Charge model cost × 1.15 per request.
- Optional: x402 pay-per-request for agents.

## Before public launch

- Read OpenRouter's and each provider's terms on resale and redistribution of access.
- Fill social links (X, Telegram, GitHub) in the footer; they are `#` placeholders now.
- Replace all "Proposal" and "Sample data" content with real values.
- Final name, domain and logo (currently "Refract", `api.refract.dev`, `$RFX` are placeholders).
- Load test `/internal/compare` with abuse traffic; confirm the daily budget cap trips correctly.
