import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { agentRunLog, agentRunSteps, agentRuns, users } from "@/db/schema";
import { logActivity } from "./activity";
import { HttpError } from "./auth";
import { publish } from "./events";
import { REPORT_LEASE_MS } from "./run-state";
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

/**
 * How many closed runs a task hands out with itself.
 *
 * A history is for reading, not for auditing: twenty rows answer "what
 * happened here lately" and keep the answer to one screen. Older runs are
 * still in the table, and one of them in full is still `GET /api/runs/{id}`.
 */
const PAST_RUNS = 20;

type RunRow = {
  id: string;
  taskId: string;
  goal: string;
  step: string;
  status: string;
  control: string | null;
  startedAt: Date;
  updatedAt: Date;
  beatAt: Date;
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
  beatAt: agentRuns.beatAt,
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
    beatAt: row.beatAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    agent: { id: row.agentId, name: row.agentName, color: row.agentColor },
    stepsTotal: steps.length,
    stepsDone: steps.filter((s) => s.state === "done").length,
    lastLog,
  };
}

/**
 * Closes every open run that missed its lease.
 *
 * A killed agent writes nothing, so the board would show its card as work in
 * progress for ever. Silence is the only evidence there is, and this is where
 * the board acts on it. The run ends as `lost`, which is not `failed`: nobody
 * knows what happened, and saying so is the honest answer.
 *
 * It counts reports, not beats. A beat left running by a dead session must
 * never be able to hold a card open.
 *
 * A run that is waiting is left alone. It asked a person something and
 * stopped on purpose, so its silence is the expected answer, not evidence.
 * Take over still ends it at any moment.
 *
 * It sits on the read path because the board is read far more often than any
 * schedule would fire, and one UPDATE behind an index costs less than a job
 * this project would then have to run, watch and ship.
 */
async function sweepLost(scope: SQL | undefined): Promise<void> {
  const cutoff = new Date(Date.now() - REPORT_LEASE_MS);
  const closed = await db
    .update(agentRuns)
    .set({ status: "lost", control: null, endedAt: new Date() })
    .where(
      and(
        isNull(agentRuns.endedAt),
        ne(agentRuns.status, "waiting"),
        lt(agentRuns.updatedAt, cutoff),
        scope,
      ),
    )
    .returning({
      id: agentRuns.id,
      projectId: agentRuns.projectId,
      taskId: agentRuns.taskId,
      agentId: agentRuns.agentId,
    });

  for (const run of closed) {
    await addLog(run.id, "no word from the agent, so the board closed the run");
    // Through the funnel, like every other write. The sweep opens no
    // transaction of its own, so there is no handle to hand on.
    await logActivity({
      projectId: run.projectId,
      taskId: run.taskId,
      actorId: run.agentId,
      kind: "run",
      data: { action: "lost" },
    });
    await publish({ projectId: run.projectId, scope: "board", taskId: run.taskId });
  }
}

/**
 * A list of runs, with the plan counts and the newest log line of each.
 *
 * The newest line is picked per run rather than off one ordered page of the
 * table: twenty runs of one task can be forty lines of one of them, and a row
 * whose last word went missing that way would be a lie the reader cannot see.
 */
async function shapeMany(rows: RunRow[]): Promise<AgentRunDTO[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [stepRows, logRows] = await Promise.all([
    db
      .select()
      .from(agentRunSteps)
      .where(inArray(agentRunSteps.runId, ids))
      .orderBy(asc(agentRunSteps.index)),
    db
      .selectDistinctOn([agentRunLog.runId], { runId: agentRunLog.runId, text: agentRunLog.text })
      .from(agentRunLog)
      .where(inArray(agentRunLog.runId, ids))
      .orderBy(agentRunLog.runId, desc(agentRunLog.createdAt)),
  ]);

  const stepsByRun = new Map<string, AgentRunStepDTO[]>();
  for (const s of stepRows) {
    const list = stepsByRun.get(s.runId) ?? [];
    list.push({ id: s.id, text: s.text, state: s.state as RunStepState, index: s.index });
    stepsByRun.set(s.runId, list);
  }

  const newestLog = new Map<string, string>();
  for (const l of logRows) newestLog.set(l.runId, l.text);

  return rows.map((row) => shape(row, stepsByRun.get(row.id) ?? [], newestLog.get(row.id) ?? null));
}

/** Every open run of a project, for the board. */
export async function loadOpenRuns(projectId: string): Promise<AgentRunDTO[]> {
  await sweepLost(eq(agentRuns.projectId, projectId));

  const rows = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(users, eq(users.id, agentRuns.agentId))
    .where(and(eq(agentRuns.projectId, projectId), isNull(agentRuns.endedAt)))
    .orderBy(asc(agentRuns.startedAt));

  return shapeMany(rows);
}

/**
 * The runs of one task: the open one in full, and the closed ones behind it.
 *
 * Both halves come out of one sweep on purpose. A run the lease closes while
 * this read is happening belongs to the history in the same answer; reading
 * the two apart would drop it out of both and the panel would show a task
 * that never ran.
 */
export async function loadTaskRuns(
  taskId: string,
): Promise<{ run: AgentRunDetailDTO | null; pastRuns: AgentRunDTO[] }> {
  await sweepLost(eq(agentRuns.taskId, taskId));

  const [openRows, closedRows] = await Promise.all([
    db
      .select(runColumns)
      .from(agentRuns)
      .innerJoin(users, eq(users.id, agentRuns.agentId))
      .where(and(eq(agentRuns.taskId, taskId), isNull(agentRuns.endedAt)))
      .limit(1),
    db
      .select(runColumns)
      .from(agentRuns)
      .innerJoin(users, eq(users.id, agentRuns.agentId))
      .where(and(eq(agentRuns.taskId, taskId), isNotNull(agentRuns.endedAt)))
      // Newest first by when the run started, because that is the moment the
      // row prints. Ordered by the end, a long run that finished a minute ago
      // sits above a short one that started after it and the words read out
      // of order. Two runs that started in the same moment fall back to the
      // id, so the list never shuffles between reads.
      .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
      .limit(PAST_RUNS),
  ]);

  const [run, pastRuns] = await Promise.all([
    openRows[0] ? withDetail(openRows[0]) : null,
    shapeMany(closedRows),
  ]);

  return { run, pastRuns };
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

/**
 * A beat: the process is alive. It writes one column and no more.
 *
 * It must not touch `updatedAt`, which is the last report and the only thing
 * the lease counts, and it must not write the log. A card that says "writing
 * the tests" has to mean the agent said so.
 */
export async function beat(runId: string): Promise<void> {
  await db.update(agentRuns).set({ beatAt: new Date() }).where(eq(agentRuns.id, runId));
}
