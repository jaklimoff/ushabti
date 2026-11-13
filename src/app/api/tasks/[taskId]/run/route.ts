import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, projects } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { agentOnly, body, broadcast, clientIdOf, guard, json, optionalStr, route } from "@/lib/api";
import { rulesHash } from "@/lib/agent-rules-hash";
import { logActivity, taskProjectId } from "@/lib/queries";
import { addLog, closeHandOver, loadRun, replaceSteps } from "@/lib/runs";

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

  /*
   * A run that handed the task on is the one open run a claim may close. It
   * stopped on purpose and said who was next, so whoever arrives finishes it
   * and starts their own. Every other open run is the lock, and stays one.
   *
   * Closing that run and opening this one is one act, so it is one
   * transaction. The insert asks `agent_runs_open_task_key` itself rather
   * than a select before it: two claims on a free task both find nothing to
   * read, and the index is the one place that sees them both. The one that
   * loses inserts nothing and gets the ordinary 409, and a hand-over it
   * closed rolls back with it.
   */
  const { runId, handedFrom } = await db.transaction(async (tx) => {
    const handed = await closeHandOver(tx, taskId, user.name);

    const [row] = await tx
      .insert(agentRuns)
      .values({ projectId, taskId, agentId: user.id, goal, step: step || steps[0] || "" })
      .onConflictDoNothing({ target: agentRuns.taskId, where: sql`ended_at is null` })
      .returning({ id: agentRuns.id });
    if (!row) throw new HttpError(409, "Another run is already open on this task.");

    if (steps.length) await replaceSteps(row.id, steps, tx);
    await addLog(row.id, goal ? `started: ${goal}` : "started", tx);
    return { runId: row.id, handedFrom: handed?.agentId ?? null };
  });

  /* Activity goes through the funnel, outside the transaction, like every
     other line: it rings webhooks, and nothing may ring for a write that
     rolled back. */
  if (handedFrom) {
    await logActivity({
      projectId,
      taskId,
      actorId: handedFrom,
      kind: "run",
      data: { action: "done" },
    });
  }
  await logActivity({
    projectId,
    taskId,
    actorId: user.id,
    kind: "run",
    data: { action: "started", goal },
  });
  await broadcast({ projectId, scope: "board", taskId, clientId: clientIdOf(req) });

  /* How to work on this board. The claim is the one run answer that carries
     it, so a run pays for the text once and not on every step or beat; an
     agent with no run reads `/api/projects/<id>/agent-rules`. The hash
     names the version, to match against the `rules` line that wrote it. */
  const [project] = await db
    .select({ agentRules: projects.agentRules })
    .from(projects)
    .where(eq(projects.id, projectId));
  const text = project?.agentRules ?? "";

  return json({ run: await loadRun(runId), rules: { text, hash: rulesHash(text) } }, 201);
});
