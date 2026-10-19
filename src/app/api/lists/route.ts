import { db } from "@/db";
import { listSources, lists } from "@/db/schema";
import { HttpError, requireActor, requireMembership } from "@/lib/auth";
import { body, humanOnly, json, readId, route, str } from "@/lib/api";
import { readFilters } from "@/lib/filters";
import { NAME_MAX, namedAfter } from "@/lib/lists";
import { listsOf } from "@/lib/lists-load";
import { loadProperties } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";

/** The person's lists, by name, for the sidebar. An agent has none. */
export const GET = route(async () => {
  const user = await requireActor();
  humanOnly(user);
  const rows = await listsOf(user.id);
  return json({ lists: rows.map((l) => ({ id: l.id, name: l.name })) });
});

/** The projects a new list reads, as the request names them. */
function readSources(input: { projectId?: unknown; sources?: unknown }) {
  if (input.sources === undefined) {
    if (input.projectId === undefined) throw new HttpError(400, "A list needs a project.");
    return [{ projectId: readId(input.projectId, "project"), filters: undefined as unknown }];
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new HttpError(400, "A list needs a project.");
  }
  const seen = new Set<string>();
  return input.sources.map((raw: unknown) => {
    const entry = (raw ?? {}) as { projectId?: unknown; filters?: unknown };
    const projectId = readId(entry.projectId, "project");
    if (seen.has(projectId)) throw new HttpError(400, "A project is on the list twice.");
    seen.add(projectId);
    return { projectId, filters: entry.filters };
  });
}

/**
 * A new list, its projects and their rules, written together. A list that
 * reads nothing is not a state, so there is no list without a project to make.
 * Each source's rules are read against its project, as a source's are on
 * every later write. A list left unnamed is named after its projects.
 */
export const POST = route(async (req) => {
  const user = await requireActor();
  humanOnly(user);
  const input = await body<{ name?: unknown; projectId?: unknown; sources?: unknown }>(req);
  const asked = readSources(input);
  const typed = input.name === undefined ? "" : str(input.name, "Name", { min: 0, max: NAME_MAX });
  const sources = await Promise.all(
    asked.map(async ({ projectId, filters }) => {
      const { projectName } = await requireMembership(user.id, projectId);
      return {
        projectId,
        projectName,
        filters: readFilters(filters, await loadProperties(projectId)),
      };
    }),
  );
  const name = typed || namedAfter(sources.map((s) => s.projectName));
  const rows = await listsOf(user.id);
  const list = await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(lists)
      .values({ userId: user.id, name, position: rankAfter(rows.at(-1)?.position) })
      .returning({ id: lists.id, name: lists.name });
    let position: string | undefined;
    await tx.insert(listSources).values(
      sources.map((s) => {
        position = rankAfter(position);
        return { listId: made.id, projectId: s.projectId, filters: s.filters, position };
      }),
    );
    return made;
  });
  return json({ list }, 201);
});
