const DEV_URL = "postgres://ushabti:ushabti@localhost:5435/ushabti";

/**
 * The database to talk to. Outside production a missing URL means the
 * docker-compose.yml database. In production it is an error: the dev URL
 * would only fail later, as a refused connection that names no cause.
 * `next build` loads this module with no database at all, so the build passes.
 */
export function databaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const url = env.DATABASE_URL;
  if (url) return url;
  if (env.NODE_ENV !== "production") return DEV_URL;
  if (env.NEXT_PHASE === "phase-production-build") return undefined;
  throw new Error("DATABASE_URL is not set.");
}

/**
 * The database for what needs a session of its own: the LISTEN client of
 * live updates. A pooler in transaction mode hands each query to any server
 * connection, so a LISTEN through it hears nothing and says nothing. Point
 * DATABASE_DIRECT_URL past the pooler and leave DATABASE_URL on it for the
 * queries. Unset or empty, it is the same database as the queries.
 * `scripts/migrate.mjs` and `scripts/baseline.mjs` read the two by hand the
 * same way, because they are plain JavaScript and cannot import this.
 */
export function directDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.DATABASE_DIRECT_URL || databaseUrl(env);
}

/**
 * How many connections this process may hold. Twelve suits a database that
 * belongs to Ushabti alone. A managed cluster shared with other applications
 * usually allows far fewer in total — DigitalOcean's smallest allows 25 for
 * everything on it — so set DATABASE_POOL_MAX there and leave room for the
 * others. Live updates open one more connection per process on top of this,
 * for LISTEN.
 * An empty value is the production compose file saying it is unset.
 */
export function poolMax(env: Record<string, string | undefined> = process.env): number {
  return Math.max(1, Number(env.DATABASE_POOL_MAX) || 12);
}
