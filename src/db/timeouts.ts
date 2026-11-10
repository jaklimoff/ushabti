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

/** True when the error, or what it wraps, is a wait that ran out. */
export function isDatabaseTimeout(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (typeof e !== "object") return false;
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && TIMEOUT_CODES.has(code)) return true;
    if (typeof message === "string" && /timeout exceeded when trying to connect/i.test(message)) {
      return true;
    }
    e = cause;
  }
  return false;
}
