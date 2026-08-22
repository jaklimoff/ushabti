import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { agentOnly, body, broadcast, clientIdOf, guard, json, optionalStr, route } from "@/lib/api";
import { logActivity, taskProjectId } from "@/lib/queries";
import { addLog, loadRun, replaceSteps } from "@/lib/runs";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * An agent claims a task and opens a run on it. One task holds one open run,
 * so a second agent has to wait or a person has to take the task over.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");

  const { user } = await guard(projectId);
  agentOnly(user);

  const input = await body<{ goal?: string; step?: string; steps?: unknown }>(req);
  const goal = optionalStr(input.goal, "Goal", 200)?.trim() ?? "";
  const step = optionalStr(input.step, "Step", 200)?.trim() ?? "";

  const steps = Array.isArray(input.steps)
    ? input.steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  if (steps.length > 50) throw new HttpError(400, "A plan has at most 50 steps.");

  const held = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.taskId, taskId), isNull(agentRuns.endedAt)))
    .limit(1);
  if (held.length) throw new HttpError(409, "Another run is already open on this task.");

  const [row] = await db
    .insert(agentRuns)
    .values({ projectId, taskId, agentId: user.id, goal, step: step || steps[0] || "" })
    .returning({ id: agentRuns.id });

  if (steps.length) await replaceSteps(row.id, steps);
  await addLog(row.id, goal ? `started: ${goal}` : "started");

  await logActivity({
    projectId,
    taskId,
    actorId: user.id,
    kind: "run",
    data: { action: "started", goal },
  });
  await broadcast({ projectId, scope: "board", taskId, clientId: clientIdOf(req) });

  return json({ run: await loadRun(row.id) }, 201);
});
