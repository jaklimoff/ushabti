import { sql, type Column } from "drizzle-orm";

/**
 * Rank strings mix upper and lower case. The default database collation sorts
 * case-insensitively, which breaks the order, so every rank sort asks for the
 * plain byte order of the "C" collation.
 */
export function byPos(column: Column) {
  return sql`${column} COLLATE "C" ASC`;
}
