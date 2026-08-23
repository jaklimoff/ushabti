import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, ownerOnly, route, str } from "@/lib/api";

type Ctx = { params: Promise<{ projectId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "rename the project");

  const input = await body<{ name?: string; key?: string }>(req);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = str(input.name, "Project name", { max: 80 });
  if (input.key !== undefined) {
    const key = str(input.key, "Project key", { max: 6 })
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!key) throw new HttpError(400, "The project key needs at least one letter or digit.");
    patch.key = key;
  }
  if (Object.keys(patch).length === 0) return json({ ok: true });

  await db.update(projects).set(patch).where(eq(projects.id, projectId));
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "delete the project");
  await db.delete(projects).where(eq(projects.id, projectId));
  return json({ ok: true });
});
