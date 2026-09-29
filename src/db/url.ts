const DEV_URL = "postgres://ushabti:ushabti@localhost:5435/ushabti";

/**
 * The database to talk to. Outside production a missing URL means the
 * docker-compose.yml database. In production it is an error: the dev URL
 * would only fail later, as a refused connection that names no cause.
 * `next build` loads this module with no database at all, so the build passes.
 */
export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV !== "production") return DEV_URL;
  if (process.env.NEXT_PHASE === "phase-production-build") return undefined;
  throw new Error("DATABASE_URL is not set.");
}

/**
 * How many connections this process may hold. Twelve suits a database that
 * belongs to Ushabti alone. A managed cluster shared with other applications
 * usually allows far fewer in total — DigitalOcean's smallest allows 25 for
 * everything on it — so set DATABASE_POOL_MAX there and leave room for the
 * others. Live updates open one more connection on top of this, for LISTEN.
 * An empty value is the production compose file saying it is unset.
 */
export function poolMax(env: Record<string, string | undefined> = process.env): number {
  return Math.max(1, Number(env.DATABASE_POOL_MAX) || 12);
}
