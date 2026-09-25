# Dualyne website. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t dualyne-web .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=true NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @dualyne/web...
COPY packages packages
COPY apps/web apps/web
# Public values are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_SITE_DOMAIN
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_COMPARE_LIMIT_PER_HOUR=10
ARG NEXT_PUBLIC_SIWE_CHAIN_ID=
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
ARG NEXT_PUBLIC_DLYN_TOKEN_ADDRESS=
ARG NEXT_PUBLIC_PASS_NFT_ADDRESS=
ARG NEXT_PUBLIC_DLYN_BUY_URL=
ARG NEXT_PUBLIC_DLYN_CHART_URL=
ARG NEXT_PUBLIC_EXPLORER_URL=
ARG NEXT_PUBLIC_X_URL=
ARG NEXT_PUBLIC_TELEGRAM_URL=
RUN pnpm --filter @dualyne/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
