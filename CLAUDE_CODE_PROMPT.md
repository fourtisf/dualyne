# Prompt for Claude Code — Refract

Copy everything below the line into Claude Code, run from the root of this folder.

---

You are building and deploying the production version of Refract: an AI model comparison website and OpenAI-compatible API gateway. Access is tied to crypto wallets and funded by a token treasury. The end result must be a real, public website on a real domain with HTTPS.

## Source of truth
- `docs/refract.html` — the finished front-end prototype. Match its design exactly: dark theme, Geist fonts, colors, spacing, components, copy. Do not redesign anything.
- `docs/HANDOFF.md` — backend spec, phases, endpoints and safety rules. Follow it.

Read both files completely before writing any code.

## Stack
- Monorepo: `apps/web` (Next.js 14 App Router, TypeScript) and `apps/api` (Fastify, TypeScript)
- Prisma + PostgreSQL, Redis
- OpenRouter as the only model provider
- viem for on-chain reads, SIWE (EIP-4361) for wallet sign-in
- zod for all input validation
- Docker + Docker Compose for local development and production

## How to work
1. First write `PLAN.md`: folder structure, Prisma schema, endpoint list, env variables, how refract.html splits into React components, and the deployment plan. Stop and wait for approval.
2. Build one phase at a time in the order below. After each phase:
   - run lint, typecheck and tests
   - commit with a clear message
   - write a short summary: what works, how to test it, what is left
   - stop and wait before starting the next phase
3. If anything in the spec is unclear or conflicts, ask. Don't guess.

## Phase 1 — Website + all models live
- Convert refract.html into Next.js components with identical output. `/docs` and `/dashboard` become real routes.
- `POST /v1/chat/completions` and `GET /v1/models`: OpenAI-compatible, SSE streaming passed through unchanged.
- `POST /internal/compare` for the website's Compare tool: Cloudflare Turnstile, 10 requests/hour per IP, explorer-tier models only, max_tokens 1000.
- Replace the prototype's `sample()` calls with fetch + SSE reading from `/internal/compare`; mark every model as live.
- `models` table mapping Refract ids to OpenRouter ids, plus a daily job verifying the ids still exist in OpenRouter's catalog.
- Global daily spend cap from `DAILY_BUDGET_USD`. When hit, free tiers return 429 until 00:00 UTC.
- Log every request: key, wallet, model, input/output tokens, cost, latency, status.

## Phase 2 — Deploy to production (make it a real website)
Before starting, ask me for: the domain name, the server (IP + SSH user) or hosting choice, and confirm DNS is pointed. Default target if I have no preference: one Ubuntu 22.04+ VPS (2 vCPU, 4 GB RAM minimum).

Deliver:
- Production `Dockerfile` for web and api (multi-stage, non-root user) and `docker-compose.prod.yml` with web, api, postgres, redis. Postgres and Redis are not exposed to the internet.
- Nginx reverse proxy: `domain.com` → web, `api.domain.com` → api. SSE must work through the proxy (disable buffering on the API routes, long read timeout).
- HTTPS with Let's Encrypt (certbot) and auto-renewal. Redirect HTTP to HTTPS.
- Cloudflare in front of the domain (proxied DNS). Document the exact DNS records to create.
- `.env.production.example` listing every variable, with comments. Real secrets only on the server.
- Prisma migrations run automatically on deploy.
- Health endpoints `/health` on web and api; containers restart automatically.
- Nightly Postgres backup to a file, keeping 7 days.
- GitHub Actions: on push to `main`, run tests, then deploy over SSH (pull, build, migrate, restart) with zero manual steps.
- `DEPLOY.md`: step-by-step guide a non-developer can follow, from a fresh server to a live site, including how to roll back.

Definition of done: the site loads at `https://domain.com`, a GPT vs Claude comparison streams live, `curl https://api.domain.com/v1/chat/completions` works with a test key, and a push to `main` redeploys automatically.

## Phase 3 onward
Continue with HANDOFF.md Phases 2–4 (wallet accounts and keys, token tiers and treasury, community leaderboard and payments). Each one ships through the same CI/CD pipeline.

## Hard rules
- The OpenRouter key exists only on the server. Never in the browser, logs, or git.
- Store API keys only as SHA-256 hashes. Show the full key exactly once.
- Validate every request body with zod. Rate-limit every public endpoint.
- Secrets in `.env`, committed `.env.example`, `.env*` gitignored.
- No mock data in production code. Keep "Sample data" and "Proposal" labels until real data exists.
- "Refract", "$RFX" and "refract.dev" are placeholders. Keep brand name, token symbol, domain and social links in one config file so they can be changed in one place.
- Tests required for: key auth, tier check, quota counting, budget cap, SSE streaming.
- Never run destructive commands on the production server (dropping databases, deleting volumes) without asking me first.

Start with PLAN.md.
