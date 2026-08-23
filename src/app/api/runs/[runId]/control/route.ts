import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { logActivity } from "@/lib/queries";
import { addLog, closeRun, loadRun } from "@/lib/runs";
import { RUN_CONTROLS, type RunControl, type RunStatus } from "@/lib/types";
import { isOpen } from "@/lib/run-state";

type Ctx = { params: Promise<{ runId: string }> };

/**
 * What the Pause, Stop and Take over buttons do.
 *
 * Pause, resume and stop are requests: they write a word the agent reads on
 * its next report. Nothing here can force a process on another machine, so an
 * agent that ignores the word keeps running, and the log says so.
 *
 * Take over is not a request. It ends the run at once and gives the card back
 * to the person.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { runId } = await ctx.params;
  const [context] = await db
    .select({
      id: agentRuns.id,
      projectId: agentRuns.projectId,
      taskId: agentRuns.taskId,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  if (!context) throw new HttpError(404, "Run not found.");

  const { user } = await guard(context.projectId);
  // Pause and Stop mean nothing if the agent can write them itself.
  humanOnly(user);
  if (!isOpen(context.status as RunStatus)) throw new HttpError(409, "That run is over.");

  const input = await body<{ control?: string }>(req);
  const wanted = input.control;

  if (wanted === "take_over") {
    await closeRun(runId, "taken_over");
    await addLog(runId, `${user.name} took the task over`);
    await logActivity({
      projectId: context.projectId,
      taskId: context.taskId,
      actorId: user.id,
      kind: "run",
      data: { action: "taken_over" },
    });
  } else {
    if (!RUN_CONTROLS.includes(wanted as RunControl)) {
      throw new HttpError(400, `Control must be one of: ${RUN_CONTROLS.join(", ")}, take_over.`);
    }
    await db
      .update(agentRuns)
      .set({ control: wanted as RunControl, updatedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    await addLog(runId, `${user.name} asked the agent to ${wanted}`);
  }

  await broadcast({
    projectId: context.projectId,
    scope: "board",
    taskId: context.taskId,
    clientId: clientIdOf(req),
  });

  return json({ run: await loadRun(runId) });
});
