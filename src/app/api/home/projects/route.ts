import { requireActor } from "@/lib/auth";
import { humanOnly, json, route } from "@/lib/api";
import { listProjectsNow } from "@/lib/queries";

export const dynamic = "force-dynamic";

/* Every project of the person, with who is at work in each, read afresh on
   every request. A page reads it again when its stream rings `elsewhere`. An
   agent's token opens one project and is refused. */
export const GET = route(async () => {
  const user = await requireActor();
  humanOnly(user);
  return json({ projects: await listProjectsNow(user.id) });
});
