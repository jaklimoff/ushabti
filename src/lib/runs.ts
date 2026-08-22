import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentRunLog, agentRunSteps, agentRuns, users } from "@/db/schema";
import { HttpError } from "./auth";
import type {
  AgentRunDTO,
  AgentRunDetailDTO,
  AgentRunLogDTO,
  AgentRunStepDTO,
  RunControl,
  RunStatus,
  RunStepState,
} from "./types";

/** The panel shows the tail of the log. The table keeps everything. */
const LOG_TAIL = 40;

type RunRow = {
  id: string;
  taskId: string;
  goal: string;
  step: string;
  status: string;
  control: string | null;
  startedAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
  agentId: string;
  agentName: string;
  agentColor: string;
};

const runColumns = {
  id: agentRuns.id,
  taskId: agentRuns.taskId,
  goal: agentRuns.goal,
  step: agentRuns.step,
  status: agentRuns.status,
  control: agentRuns.control,
  startedAt: agentRuns.startedAt,
  updatedAt: agentRuns.updatedAt,
  endedAt: agentRuns.endedAt,
  agentId: users.id,
  agentName: users.name,
  agentColor: users.color,
};

function shape(row: RunRow, steps: AgentRunStepDTO[], lastLog: string | null): AgentRunDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    goal: row.goal,
    step: row.step,
    status: row.status as RunStatus,
    control: (row.control as RunControl | null) ?? null,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    agent: { id: row.agentId, name: row.agentName, color: row.agentColor },
    stepsTotal: steps.length,
    stepsDone: steps.filter((s) => s.state === "done").length,
    lastLog,
  };
}

/** Every open run of a project, for the board. */
export async function loadOpenRuns(projectId: string): Promise<AgentRunDTO[]> {
  const rows = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(users, eq(users.id, agentRuns.agentId))
    .where(and(eq(agentRuns.projectId, projectId), isNull(agentRuns.endedAt)))
    .orderBy(asc(agentRuns.startedAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [stepRows, logRows] = await Promise.all([
    db
      .select()
      .from(agentRunSteps)
      .where(inArray(agentRunSteps.runId, ids))
      .orderBy(asc(agentRunSteps.index)),
    db
      .select()
      .from(agentRunLog)
      .where(inArray(agentRunLog.runId, ids))
      .orderBy(desc(agentRunLog.createdAt))
      .limit(ids.length * 4),
  ]);

  const stepsByRun = new Map<string, AgentRunStepDTO[]>();
  for (const s of stepRows) {
    const list = stepsByRun.get(s.runId) ?? [];
    list.push({ id: s.id, text: s.text, state: s.state as RunStepState, index: s.index });
    stepsByRun.set(s.runId, list);
  }

  const newestLog = new Map<string, string>();
  for (const l of logRows) if (!newestLog.has(l.runId)) newestLog.set(l.runId, l.text);

  return rows.map((row) => shape(row, stepsByRun.get(row.id) ?? [], newestLog.get(row.id) ?? null));
}

/** The open run of one task, with its plan and the tail of its log. */
export async function loadTaskRun(taskId: string): Promise<AgentRunDetailDTO | null> {
  const [row] = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(users, eq(users.id, agentRuns.agentId))
    .where(and(eq(agentRuns.taskId, taskId), isNull(agentRuns.endedAt)))
    .limit(1);

  if (!row) return null;
  return withDetail(row);
}

export async function loadRun(runId: string): Promise<AgentRunDetailDTO> {
  const [row] = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(users, eq(users.id, agentRuns.agentId))
    .where(eq(agentRuns.id, runId))
    .limit(1);

  if (!row) throw new HttpError(404, "Run not found.");
  return withDetail(row);
}

async function withDetail(row: RunRow): Promise<AgentRunDetailDTO> {
  const [stepRows, logRows] = await Promise.all([
    db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.runId, row.id))
      .orderBy(asc(agentRunSteps.index)),
    db
      .select()
      .from(agentRunLog)
      .where(eq(agentRunLog.runId, row.id))
      .orderBy(desc(agentRunLog.createdAt))
      .limit(LOG_TAIL),
  ]);

  const steps: AgentRunStepDTO[] = stepRows.map((s) => ({
    id: s.id,
    text: s.text,
    state: s.state as RunStepState,
    index: s.index,
  }));

  const log: AgentRunLogDTO[] = logRows
    .map((l) => ({ id: l.id, text: l.text, createdAt: l.createdAt.toISOString() }))
    .reverse();

  return { ...shape(row, steps, log.at(-1)?.text ?? null), steps, log };
}

/** The project and the open run of a task, or 404. */
export async function runContext(runId: string) {
  const [row] = await db
    .select({
      id: agentRuns.id,
      projectId: agentRuns.projectId,
      taskId: agentRuns.taskId,
      agentId: agentRuns.agentId,
      status: agentRuns.status,
      control: agentRuns.control,
      endedAt: agentRuns.endedAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  if (!row) throw new HttpError(404, "Run not found.");
  return row;
}

export async function replaceSteps(runId: string, texts: string[]): Promise<void> {
  await db.delete(agentRunSteps).where(eq(agentRunSteps.runId, runId));
  if (texts.length === 0) return;
  await db.insert(agentRunSteps).values(
    texts.map((text, index) => ({
      runId,
      text: text.slice(0, 200),
      state: index === 0 ? "active" : "todo",
      index,
    })),
  );
}

/** Marks everything before `index` done, `index` active, the rest still to do. */
export async function setCurrentStep(runId: string, index: number): Promise<void> {
  const rows = await db
    .select({ id: agentRunSteps.id, index: agentRunSteps.index })
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, runId));

  for (const row of rows) {
    const state: RunStepState =
      row.index < index ? "done" : row.index === index ? "active" : "todo";
    await db.update(agentRunSteps).set({ state }).where(eq(agentRunSteps.id, row.id));
  }
}

export async function addLog(runId: string, text: string): Promise<void> {
  await db.insert(agentRunLog).values({ runId, text: text.slice(0, 400) });
}

/** Closes a run and leaves the task free for the next one. */
export async function closeRun(runId: string, status: RunStatus): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status, control: null, endedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));
}
