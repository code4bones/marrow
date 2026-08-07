# syntax=docker/dockerfile:1

# Runtime image for the pm3m gateway. Postgres and artifact storage stay
# external (mounted volume / existing host Postgres) — this container is the
# Node process only, meant to replace the PM2-managed process on the same
# host:port (see ecosystem.config.cjs), not a full docker-compose stack.

# better-sqlite3 is a native module (used by the local SQLite mode). Its
# prebuilt binary download is not always reachable from the build host, so
# python3/make/g++ are installed as a node-gyp source-build fallback.
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run typecheck
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/docs ./docs
COPY --from=build /app/knexfile.cjs ./knexfile.cjs
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/AGENTS.md ./AGENTS.md

EXPOSE 7000
CMD ["node", "dist/src/gateway.js"]
