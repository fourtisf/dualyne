# Refract API. Build from the repository root:
# The base image already has libssl 3 (needed by Prisma) and busybox wget (healthcheck).
#   docker build -f apps/api/Dockerfile -t refract-api .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=true NEXT_TELEMETRY_DISABLED=1

# Manifests only, so dependency layers are cached until they change.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @refract/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @refract/api build

# Production dependencies only (prisma CLI is a dependency: the migrate step needs it).
FROM manifests AS prod
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @refract/api...
COPY packages packages
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && node_modules/.bin/prisma generate

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod /repo/node_modules ./node_modules
COPY --from=prod /repo/packages ./packages
COPY --from=prod /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod /repo/apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
