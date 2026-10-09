import { db } from "@/db";
import { listSources, lists } from "@/db/schema";
import { HttpError, requireActor, requireMembership } from "@/lib/auth";
import { body, humanOnly, json, readId, route, str } from "@/lib/api";
import { listsOf } from "@/lib/lists-load";
import { rankAfter } from "@/lib/rank";

/** The person's lists, by name, for the switcher. An agent has none. */
export const GET = route(async () => {
  const user = await requireActor();
  humanOnly(user);
  const rows = await listsOf(user.id);
  return json({ lists: rows.map((l) => ({ id: l.id, name: l.name })) });
});

/**
 * A new list and its first project, written together. A list that reads
 * nothing is not a state, so there is no list without a project to make.
 */
export const POST = route(async (req) => {
  const user = await requireActor();
  humanOnly(user);
  const input = await body<{ name?: unknown; projectId?: unknown }>(req);
  if (input.projectId === undefined) throw new HttpError(400, "A list needs a project.");
  const projectId = readId(input.projectId, "project");
  const name = input.name === undefined ? "New list" : str(input.name, "Name", { max: 80 });
  await requireMembership(user.id, projectId);
  const rows = await listsOf(user.id);
  const list = await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(lists)
      .values({ userId: user.id, name, position: rankAfter(rows.at(-1)?.position) })
      .returning({ id: lists.id, name: lists.name });
    await tx.insert(listSources).values({
      listId: made.id,
      projectId,
      filters: { rules: [] },
      position: rankAfter(undefined),
    });
    return made;
  });
  return json({ list }, 201);
});
