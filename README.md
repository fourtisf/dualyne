# Dualyne

AI model comparison website and OpenAI-compatible API gateway. Access is tied to crypto wallets and funded by a token treasury.

- `apps/web`: Next.js 14 website (the design from `docs/refract.html`)
- `apps/api`: Fastify API (`/v1/chat/completions`, `/v1/models`, `/internal/compare`, …)
- `packages/config`: **brand config** (name, token symbol, domain, social links, contact) in one file
- `packages/shared`: model catalog, tier limits and schemas shared by web and API

See `PLAN.md` for the architecture, phase plan and status, `docs/HANDOFF.md` for the product spec, and **`DEPLOY.md`** (in Indonesian) for putting it on a server.

## Run it locally

Requirements: Node 22, pnpm 10, Docker (or your own Postgres 16 and Redis 7).

```bash
pnpm install
cp .env.example .env            # then put your OpenRouter key in OPENROUTER_API_KEY
docker compose up -d            # Postgres + Redis on localhost
pnpm --filter @dualyne/api db:deploy   # create tables
pnpm --filter @dualyne/api db:seed     # load the model catalog
pnpm dev                        # web on http://localhost:3000, API on http://localhost:4000
```

Create a test API key (keys are self-serve once wallet sign-in ships):

```bash
pnpm --filter @dualyne/api key:create --wallet 0xYourAddress --tier holder
```

Check or update the OpenRouter model mapping:

```bash
pnpm --filter @dualyne/api models:resolve
pnpm --filter @dualyne/api models:resolve --set gpt=openai/gpt-5.1
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

API tests need Postgres and Redis (the `docker compose` services above; the test database is `dualyne_test`).

## Changing the brand

Edit `packages/config/src/brand.ts`. The name, token symbol, domain, key prefix, social links and contact email are read from there everywhere. Set `SITE_DOMAIN` / `NEXT_PUBLIC_SITE_DOMAIN` to change the domain without editing code.
