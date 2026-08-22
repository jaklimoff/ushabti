import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { HttpError, requireActor, requireMembership } from "@/lib/auth";
import { agentOnly, json, route } from "@/lib/api";

/**
 * The first call an agent makes. It answers "who am I and which board am I
 * on", so nothing else needs the project id in its configuration.
 */
export const GET = route(async () => {
  const actor = await requireActor();
  agentOnly(actor);
  const projectId = actor.tokenProjectId;
  if (!projectId) throw new HttpError(401, "That token is not valid any more.");

  const membership = await requireMembership(actor.id, projectId);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  return json({
    agent: { id: actor.id, name: actor.name, color: actor.color },
    project: {
      id: project.id,
      name: project.name,
      key: project.key,
      role: membership.role,
    },
  });
});
