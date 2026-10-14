import "server-only";
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { byPos } from "@/lib/order";
import { lineWith, SEARCH_LIMIT, wordsOf, type ArchivedFound } from "./search";

/* A query longer than this is not somebody looking for a task. */
const MOST_WORDS = 12;
const LONGEST_WORD = 100;

/**
 * The archived tasks found only through their description.
 *
 * The board carries every archived task without its description, so the
 * browser finds one by its key or its title on the keystroke and asks here for
 * the rest. A task the key and the title already answer is left out, because
 * the browser lists it already, and the count is of the rest alone. The rule
 * is the browser's: every word has to be somewhere in the key, the title or
 * the description.
 */
export async function searchArchived(projectId: string, query: string): Promise<ArchivedFound> {
  const words = wordsOf(query)
    .slice(0, MOST_WORDS)
    .map((word) => word.slice(0, LONGEST_WORD));
  if (!words.length) return { hits: [], total: 0 };

  const [project] = await db
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return { hits: [], total: 0 };

  /* `strpos` and not `like`, so a % or an _ in the words means itself. */
  const head = sql`lower(${project.key} || '-' || ${tasks.number}::text || E'\\n' || ${tasks.title})`;
  const whole = sql`(${head} || E'\\n' || lower(${tasks.description}))`;
  const allIn = (text: SQL) =>
    sql.join(
      words.map((word) => sql`strpos(${text}, ${word}) > 0`),
      sql` and `,
    );

  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      position: tasks.position,
      archivedAt: tasks.archivedAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNotNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
        sql`(${allIn(whole)})`,
        sql`not (${allIn(head)})`,
      ),
    )
    /* The browser's order for two hits of one rank and one standing: the
       newest first, then the order every view shares. */
    .orderBy(desc(tasks.archivedAt), byPos(tasks.position))
    .limit(SEARCH_LIMIT);

  return {
    hits: rows.map((row) => ({
      task: {
        id: row.id,
        number: row.number,
        key: `${project.key}-${row.number}`,
        title: row.title,
        position: row.position,
        archivedAt: (row.archivedAt as Date).toISOString(),
      },
      snippet: lineWith(row.description, words),
    })),
    total: rows[0]?.total ?? 0,
  };
}
