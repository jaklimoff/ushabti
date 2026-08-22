# Production image. `docker-compose.yml` builds Dockerfile.dev instead.
# Node 24 is the current LTS. Do not move to an odd or a non-LTS major here.
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# `output: "standalone"` in next.config.mjs makes the build trace which files
# the server really touches and write them to .next/standalone, its own
# node_modules included. So the runner installs nothing: no npm, no registry,
# no second dependency tree. Only the traced files reach the image.
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# Apply any new migration, then serve. `server.js` is the traced server; it
# reads PORT and HOSTNAME itself, so there is no `next start` here.
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
