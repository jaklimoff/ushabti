import { db } from "@/db";
import { lists } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { humanOnly, json, route } from "@/lib/api";
import { listsOf } from "@/lib/lists-load";
import { rankAfter } from "@/lib/rank";

/** The person's lists, by name, for the switcher. An agent has none. */
export const GET = route(async () => {
  const user = await requireActor();
  humanOnly(user);
  const rows = await listsOf(user.id);
  return json({ lists: rows.map((l) => ({ id: l.id, name: l.name })) });
});

/** A new list, named "New list" and holding no source yet. */
export const POST = route(async () => {
  const user = await requireActor();
  humanOnly(user);
  const rows = await listsOf(user.id);
  const [list] = await db
    .insert(lists)
    .values({ userId: user.id, name: "New list", position: rankAfter(rows.at(-1)?.position) })
    .returning({ id: lists.id, name: lists.name });
  return json({ list }, 201);
});
