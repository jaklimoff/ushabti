import { requireActor, requireUser } from "@/lib/auth";
import { body, humanOnly, json, route, str } from "@/lib/api";
import { createProject, listProjects } from "@/lib/queries";
import { suggestProjectKey } from "@/lib/defaults";

/* A personal token reads this too, so a script finds out what it reaches.
   Making a project stays a session's: it has no project to be refused by. */
export const GET = route(async () => {
  const user = await requireActor();
  humanOnly(user);
  return json({ projects: await listProjects(user.id) });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const input = await body<{ name?: string; key?: string }>(req);
  const name = str(input.name, "Project name", { max: 80 });
  const rawKey =
    typeof input.key === "string" && input.key.trim() ? input.key : suggestProjectKey(name);
  const key =
    rawKey
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "TSK";

  const project = await createProject(user.id, name, key);
  return json({ project }, 201);
});
