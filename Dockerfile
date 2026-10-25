# Node.js 24.22.1 includes the CVE-2026-111497 Brotli decoder fix.
FROM node:24.22.1-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app

FROM oven/bun:1.4.2 AS bun

# Use Bun for dependency installation, and Node.js for build tools and runtime.
FROM base AS installer
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY ./package.json ./bun.lock ./
COPY ./patches ./patches

FROM installer AS prod
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc bun install --production --frozen-lockfile

FROM installer AS builder
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc bun install --frozen-lockfile && bun x prisma generate && bun run build

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=prod /usr/src/app/node_modules ./node_modules
COPY --from=builder ./usr/src/app/.env ./.env
COPY --from=builder ./usr/src/app/dist ./dist
COPY --from=builder ./usr/src/app/package.json ./package.json
COPY --from=builder ./usr/src/app/prisma ./prisma
COPY --from=builder ./usr/src/app/generated ./generated

# run the app
USER node
EXPOSE 3000/tcp
ENTRYPOINT [ "node", "--import", "./dist/instrumentation.js", "./dist/main.js" ]
