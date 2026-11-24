import { HttpError, requireActor, requireUser } from "@/lib/auth";
import { body, humanOnly, json, route, str } from "@/lib/api";
import { isId } from "@/lib/ids";
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
  const input = await body<{ name?: string; key?: string; from?: string | null }>(req);
  const name = str(input.name, "Project name", { max: 80 });
  const rawKey =
    typeof input.key === "string" && input.key.trim() ? input.key : suggestProjectKey(name);
  const key =
    rawKey
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "TSK";

  /* The setup of one of the person's own projects, instead of the default set.
     Any id that is not one answers as a project that does not exist. */
  if (input.from != null && !isId(input.from)) throw new HttpError(404, "Project not found.");
  const from = input.from ?? undefined;

  const project = await createProject(user.id, name, key, from);
  return json({ project }, 201);
});
