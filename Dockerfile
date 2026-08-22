# Production image. `docker-compose.yml` builds Dockerfile.dev instead.
# Node 24 is the current LTS. Do not move to an odd or a non-LTS major here.
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# The runner keeps only what the server needs: the build output and the
# packages listed under "dependencies".
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY next.config.mjs ./
COPY drizzle ./drizzle
COPY scripts ./scripts
USER node
EXPOSE 3000
# Apply any new migration, then serve.
CMD ["sh", "-c", "node scripts/migrate.mjs && node_modules/.bin/next start -p ${PORT} -H 0.0.0.0"]
