import { asc, eq, sql } from "drizzle-orm";
import { projects, tasks, taskValues } from "@/db/schema";
import { dropHidden } from "@/lib/hidden";
import { body, broadcast, clientIdOf, guard, json, optionalStr, route, str } from "@/lib/api";
import { loadProperties, rankOnTheEnd, withProjectLock } from "@/lib/queries";
import { byPos } from "@/lib/order";
import { rankBefore, rankBetween } from "@/lib/rank";
import type { TaskValue } from "@/lib/types";
import { coerceValue, loadProperty } from "@/lib/values";
import { readDefaults, readTypeBy, startsWith } from "@/lib/when";

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
  const { task, rewrote, ring } = await withProjectLock(projectId, async (tx) => {
    const [project] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ counter: projects.taskCounter, key: projects.key, typeBy: projects.typeBy });

    const neighbours = await tx
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(byPos(tasks.position), asc(tasks.number));

    /* A task landing on the end asks `rankOnTheEnd`, which rewrites the tail
       first if the ranks there have grown too long. A task landing between two
       others cannot: the room above its neighbour is the next task's. */
    let position: string;
    let rewrote = false;
    const i = input.afterId ? neighbours.findIndex((t) => t.id === input.afterId) : -1;
    if (i >= 0 && i < neighbours.length - 1) {
      position = rankBetween(neighbours[i].position, neighbours[i + 1].position);
    } else if (input.atTop && !input.afterId) {
      position = rankBefore(neighbours[0]?.position ?? null);
    } else {
      ({ position, rewrote } = await rankOnTheEnd(tx, projectId, neighbours));
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
    const task = { ...row, key: `${project.key}-${row.number}` };

    /* The seeds are written under the lock that wrote the task, as a rule in
       Settings is: a rule written beside this create either sees the task or
       is seen by the drop. A seed can hide another one, so the drop follows. */
    const values = input.values && typeof input.values === "object" ? input.values : {};
    const sent: Record<string, TaskValue> = {};
    for (const [propertyId, raw] of Object.entries(values)) {
      const prop = await loadProperty(propertyId);
      if (prop.projectId !== projectId) continue;
      sent[propertyId] = await coerceValue(prop, raw);
    }
    /* The type's defaults are written here and nowhere else, so a task an
       agent makes starts as one made from the composer does. A value the
       caller sent, empty or not, always wins over a default. */
    const read = readDefaults(await loadProperties(projectId, tx), project.typeBy);
    const starts = startsWith(readTypeBy(project.typeBy, read), sent, read);
    const written = { ...starts, ...sent };
    for (const [propertyId, value] of Object.entries(written)) {
      await tx
        .insert(taskValues)
        .values({ taskId: task.id, propertyId, value })
        .onConflictDoUpdate({
          target: [taskValues.taskId, taskValues.propertyId],
          set: { value },
        });
    }
    const { ring } = await dropHidden(tx, {
      projectId,
      taskIds: Object.keys(written).length ? [task.id] : [],
      actorId: user.id,
      before: [{ projectId, taskId: task.id, actorId: user.id, kind: "created", data: { title } }],
    });
    return { task, rewrote, ring };
  });

  await ring();
  /* A rewrite moved rows this tab did not ask about, so it hears the bell too. */
  await broadcast({ projectId, scope: "board", clientId: rewrote ? undefined : clientIdOf(req) });
  return json({ task }, 201);
});
