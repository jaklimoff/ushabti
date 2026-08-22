import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { agentOnly, body, broadcast, clientIdOf, guard, json, optionalStr, route } from "@/lib/api";
import { logActivity } from "@/lib/queries";
import { addLog, loadRun, replaceSteps, runContext, setCurrentStep } from "@/lib/runs";
import { CLOSED_STATUSES, RUN_STATUSES, type RunStatus } from "@/lib/types";
import { isOpen } from "@/lib/run-state";

type Ctx = { params: Promise<{ runId: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const { runId } = await ctx.params;
  const context = await runContext(runId);
  await guard(context.projectId);
  return json({ run: await loadRun(runId) });
});

/**
 * The one call an agent makes while it works. It reports the step it is on,
 * and it reads back the control word a person set, so a Pause or a Stop from
 * the board reaches it without a second request.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { runId } = await ctx.params;
  const context = await runContext(runId);
  const { user } = await guard(context.projectId);
  agentOnly(user);
  if (context.agentId !== user.id) throw new HttpError(403, "That run belongs to another agent.");
  if (!isOpen(context.status as RunStatus)) throw new HttpError(409, "That run is closed.");

  const input = await body<{
    goal?: string;
    step?: string;
    stepIndex?: number;
    steps?: unknown;
    log?: string;
    status?: string;
  }>(req);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const goal = optionalStr(input.goal, "Goal", 200);
  const step = optionalStr(input.step, "Step", 200);
  if (goal !== undefined) patch.goal = goal.trim();
  if (step !== undefined) patch.step = step.trim();

  let status: RunStatus | undefined;
  if (input.status !== undefined) {
    if (!RUN_STATUSES.includes(input.status as RunStatus)) {
      throw new HttpError(400, `Status must be one of: ${RUN_STATUSES.join(", ")}.`);
    }
    status = input.status as RunStatus;
    if (status === "taken_over") throw new HttpError(400, "Only a person takes a task over.");
    patch.status = status;
  }

  // The agent obeyed, so the request from the board is spent.
  const control = context.control ?? null;
  if (status && obeys(control, status)) patch.control = null;

  if (status && CLOSED_STATUSES.includes(status)) patch.endedAt = new Date();

  await db.update(agentRuns).set(patch).where(eq(agentRuns.id, runId));

  if (Array.isArray(input.steps)) {
    const texts = input.steps.filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0,
    );
    if (texts.length > 50) throw new HttpError(400, "A plan has at most 50 steps.");
    await replaceSteps(runId, texts);
  }

  if (typeof input.stepIndex === "number") {
    if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
      throw new HttpError(400, "stepIndex must be a whole number, zero or more.");
    }
    await setCurrentStep(runId, input.stepIndex);
  }

  const line = optionalStr(input.log, "Log", 400)?.trim();
  if (line) await addLog(runId, line);
  else if (step?.trim()) await addLog(runId, step.trim());

  if (status && CLOSED_STATUSES.includes(status)) {
    await logActivity({
      projectId: context.projectId,
      taskId: context.taskId,
      actorId: user.id,
      kind: "run",
      data: { action: status },
    });
  }

  await broadcast({
    projectId: context.projectId,
    scope: "board",
    taskId: context.taskId,
    clientId: clientIdOf(req),
  });

  const run = await loadRun(runId);
  // The control word is the answer to the report, not a field of the run.
  return json({ run, control: run.control });
});

/** True when the status the agent reports answers what the person asked for. */
function obeys(control: string | null, status: RunStatus): boolean {
  if (!control) return false;
  if (control === "pause") return status === "paused";
  if (control === "resume") return status === "running";
  if (control === "stop") return CLOSED_STATUSES.includes(status);
  return false;
}
