/**
 * How long anything may wait on the database. Every wait has a limit, so a
 * burst of writes fails a request at worst, instead of freezing the server.
 * Generous on purpose: an import of a large board and the end to end suite
 * stay far inside them.
 */
export const TIMEOUTS = {
  /** For a connection out of the pool. */
  connectMs: 10_000,
  /** For one statement. */
  statementMs: 30_000,
  /** For a row or a table lock. */
  lockMs: 15_000,
  /** For a transaction that holds its locks and says nothing. */
  idleInTransactionMs: 60_000,
} as const;

/** The statement that sets the limits, for the session or, `local`, for one transaction. */
export function timeoutSettings(local: boolean): string {
  const scope = local ? "true" : "false";
  return (
    "select " +
    [
      `set_config('statement_timeout', '${TIMEOUTS.statementMs}', ${scope})`,
      `set_config('lock_timeout', '${TIMEOUTS.lockMs}', ${scope})`,
      `set_config('idle_in_transaction_session_timeout', '${TIMEOUTS.idleInTransactionMs}', ${scope})`,
    ].join(", ")
  );
}

/* What Postgres and pg say when a limit above is reached. */
const TIMEOUT_CODES = new Set([
  "57014", // statement_timeout: query_canceled
  "55P03", // lock_timeout: lock_not_available
  "25P03", // idle_in_transaction_session_timeout
]);

/* What Postgres, pg and Node say when the database is there but cannot answer
   this request now: a lost race the database rolled back, or a connection
   that went away. A retry may pass. */
const BUSY_CODES = new Set([
  ...TIMEOUT_CODES,
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "ECONNREFUSED",
  "ECONNRESET",
]);

type PgShape = { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };

/* The error and what it wraps, as far as five deep: drizzle wraps pg's error once. */
function* chain(err: unknown): Generator<PgShape> {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    yield e as PgShape;
    e = (e as PgShape).cause;
  }
}

function isTimeout({ code, message }: PgShape): boolean {
  if (typeof code === "string" && TIMEOUT_CODES.has(code)) return true;
  return typeof message === "string" && /timeout exceeded when trying to connect/i.test(message);
}

/**
 * "busy" when the error, or what it wraps, says the database could not answer
 * now and a retry may pass. A connection lost during a commit is busy too,
 * though its write may have landed.
 */
export function classifyDbError(err: unknown): "busy" | null {
  for (const e of chain(err)) {
    if (isTimeout(e)) return "busy";
    const { code, message } = e;
    if (typeof code === "string" && (BUSY_CODES.has(code) || code.startsWith("08"))) {
      return "busy";
    }
    if (typeof message === "string" && /connection terminated/i.test(message)) return "busy";
  }
  return null;
}

/** True when the error, or what it wraps, is a wait that ran out. */
export function isDatabaseTimeout(err: unknown): boolean {
  for (const e of chain(err)) if (isTimeout(e)) return true;
  return false;
}

/** True when the error, or what it wraps, broke the one unique constraint named. */
export function uniqueViolation(err: unknown, constraint: string): boolean {
  for (const e of chain(err)) if (e.code === "23505" && e.constraint === constraint) return true;
  return false;
}
