# Bun 1.4.4 includes Brotli 1.2.1 with the CVE-2026-111497 fix.
FROM oven/bun:1.4.4 AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app

FROM base AS installer
COPY ./package.json ./bun.lock ./
COPY ./patches ./patches

FROM installer AS prod
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc bun install --production --frozen-lockfile

FROM installer AS builder
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc bun install --frozen-lockfile && bun run test:brotli-security && bunx --bun prisma generate && bun run build

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=prod /usr/src/app/node_modules ./node_modules
COPY --from=builder ./usr/src/app/.env ./.env
COPY --from=builder ./usr/src/app/dist ./dist
COPY --from=builder ./usr/src/app/package.json ./package.json
COPY --from=builder ./usr/src/app/prisma ./prisma
COPY --from=builder ./usr/src/app/generated ./generated

# run the app
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "start:prod" ]
