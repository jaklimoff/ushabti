import { asc, eq, sql } from "drizzle-orm";
import { projects, tasks } from "@/db/schema";
import { body, broadcast, clientIdOf, guard, json, optionalStr, route, str } from "@/lib/api";
import { logActivity, withProjectLock } from "@/lib/queries";
import { byPos } from "@/lib/order";
import { rankAfter, rankBefore, rankBetween } from "@/lib/rank";
import { coerceValue, loadProperty, putValue } from "@/lib/values";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);

  const input = await body<{
    title?: string;
    description?: string;
    values?: Record<string, unknown>;
    /** Put the new task straight after this one. Used by the column "+" button. */
    afterId?: string | null;
    atTop?: boolean;
  }>(req);

  const title = str(input.title, "Title", { max: 400 });
  const description = optionalStr(input.description, "Description") ?? "";

  // The counter bump and the rank both have to see the same snapshot, so the
  // whole thing runs under the project lock.
  const task = await withProjectLock(projectId, async (tx) => {
    const [project] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ counter: projects.taskCounter, key: projects.key });

    const neighbours = await tx
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(byPos(tasks.position), asc(tasks.number));

    let position: string;
    if (input.afterId) {
      const i = neighbours.findIndex((t) => t.id === input.afterId);
      position =
        i >= 0
          ? rankBetween(neighbours[i].position, neighbours[i + 1]?.position ?? null)
          : rankAfter(neighbours.at(-1)?.position ?? null);
    } else if (input.atTop) {
      position = rankBefore(neighbours[0]?.position ?? null);
    } else {
      position = rankAfter(neighbours.at(-1)?.position ?? null);
    }

    const [row] = await tx
      .insert(tasks)
      .values({
        projectId,
        number: project.counter,
        title,
        description,
        position,
        createdBy: user.id,
      })
      .returning();
    return { ...row, key: `${project.key}-${row.number}` };
  });

  if (input.values && typeof input.values === "object") {
    for (const [propertyId, raw] of Object.entries(input.values)) {
      const prop = await loadProperty(propertyId);
      if (prop.projectId !== projectId) continue;
      await putValue(task.id, propertyId, await coerceValue(prop, raw));
    }
  }

  await logActivity({
    projectId,
    taskId: task.id,
    actorId: user.id,
    kind: "created",
    data: { title },
  });
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ task }, 201);
});
