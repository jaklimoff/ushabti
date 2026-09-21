import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { agentRunLog, agentRunSteps, agentRuns, tasks, users } from "@/db/schema";
import { logActivity } from "./activity";
import { HttpError } from "./auth";
import { publish } from "./events";
import type { Tx } from "./queries";
import { REPORT_LEASE_MS, WAITING_STATUSES } from "./run-state";
import type {
  AgentRunDTO,
  AgentRunDetailDTO,
  AgentRunLogDTO,
  AgentRunRowDTO,
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
  reportDueAt: Date | null;
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
  reportDueAt: agentRuns.reportDueAt,
  endedAt: agentRuns.endedAt,
  agentId: users.id,
  agentName: users.name,
  agentColor: users.color,
};

/** A run in its own columns. It reads no other table, which is the point. */
function shapeRow(row: RunRow): AgentRunRowDTO {
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
    reportDueAt: row.reportDueAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    agent: { id: row.agentId, name: row.agentName, color: row.agentColor },
  };
}

function shape(row: RunRow, steps: AgentRunStepDTO[], lastLog: string | null): AgentRunDTO {
  return {
    ...shapeRow(row),
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
 * A report may name how long the next one takes, and then the run is judged
 * by that moment instead. It is still a report: an agent wrote it once, about
 * the step it was starting, and its next report takes it away again.
 *
 * A run that waits is left alone. It asked a person something, or handed the
 * task to somebody else, and stopped on purpose, so its silence is the
 * expected answer and not evidence. Take over still ends it at any moment,
 * and the next agent's claim closes a hand-over.
 *
 * It sits on the read path because the board is read far more often than any
 * schedule would fire, and one UPDATE behind an index costs less than a job
 * this project would then have to run, watch and ship.
 */
async function sweepLost(scope: SQL | undefined): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REPORT_LEASE_MS);
  const closed = await db
    .update(agentRuns)
    .set({ status: "lost", control: null, endedAt: new Date() })
    .where(
      and(
        isNull(agentRuns.endedAt),
        notInArray(agentRuns.status, WAITING_STATUSES),
        // The two halves of `leaseEndsAt`, asked of the rows.
        or(
          and(isNull(agentRuns.reportDueAt), lt(agentRuns.updatedAt, cutoff)),
          and(isNotNull(agentRuns.reportDueAt), lt(agentRuns.reportDueAt, now)),
        ),
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
 * The open runs, with the plan counts and the newest log line of each. A card
 * draws all three; a history row draws none of them and is shaped by `shapeRow`.
 *
 * The newest line is picked per run rather than off one ordered page of the
 * table: one talkative agent can be the whole page, and a row whose last word
 * went missing that way would be a lie the reader cannot see.
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

/**
 * A run on a task somebody can still see.
 *
 * A deleted task keeps its open run — the row is only marked, and a put back
 * has to give the work back with everything else. But nothing draws that run:
 * there is no card, and the lease leaves it open for up to half an hour. Read
 * without this, the board would carry a run nobody can reach and `me` would
 * count it, both saying an agent is busy with a task that is not there.
 *
 * It is an `EXISTS` rather than a join, because the answer wants no column of
 * `tasks` and a join would have to be kept out of `runColumns` by hand.
 *
 * It is exported so a test can read the rule without a database.
 */
export const ON_A_TASK_YOU_CAN_SEE = sql`exists (select 1 from ${tasks} where ${tasks.id} = ${agentRuns.taskId} and ${tasks.deletedAt} is null)`;

/** Every open run of a project, for the board. */
export async function loadOpenRuns(projectId: string): Promise<AgentRunDTO[]> {
  await sweepLost(eq(agentRuns.projectId, projectId));

  const rows = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(users, eq(users.id, agentRuns.agentId))
    .where(
      and(eq(agentRuns.projectId, projectId), isNull(agentRuns.endedAt), ON_A_TASK_YOU_CAN_SEE),
    )
    .orderBy(asc(agentRuns.startedAt));

  return shapeMany(rows);
}

/**
 * The runs of one task: the open one in full, and the closed ones behind it.
 *
 * Both halves come out of one sweep and one statement on purpose. A run the
 * lease closes while this read is happening belongs to the history in the
 * same answer; read apart, on two connections, a close committed between them
 * could put a run in both halves or in neither, and the panel would show a
 * task that never ran. Which half a row is in is decided here, off the rows
 * the one statement returned, where nothing can change under it.
 *
 * One task holds one open run — `agent_runs_open_task_key` says so — so the
 * newest `PAST_RUNS + 1` rows always hold `PAST_RUNS` closed ones.
 *
 * The history rows are the run rows and nothing else. The counts and the last
 * log line are two more tables, and a row draws neither of them; the run that
 * a person opens is read whole, one at a time, by `GET /api/runs/{id}`.
 */
export async function loadTaskRuns(
  taskId: string,
): Promise<{ run: AgentRunDetailDTO | null; pastRuns: AgentRunRowDTO[] }> {
  await sweepLost(eq(agentRuns.taskId, taskId));

  const rows = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(users, eq(users.id, agentRuns.agentId))
    .where(eq(agentRuns.taskId, taskId))
    // Newest first by when the run started, because that is the moment the
    // row prints. Ordered by the end, a long run that finished a minute ago
    // sits above a short one that started after it and the words read out
    // of order. Two runs that started in the same moment fall back to the
    // id, so the list never shuffles between reads.
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(PAST_RUNS + 1);

  const openRow = rows.find((row) => row.endedAt === null) ?? null;
  const closedRows = rows.filter((row) => row.endedAt !== null).slice(0, PAST_RUNS);

  return {
    run: openRow ? await withDetail(openRow) : null,
    pastRuns: closedRows.map(shapeRow),
  };
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

export async function replaceSteps(runId: string, texts: string[], tx?: Tx): Promise<void> {
  const on = tx ?? db;
  await on.delete(agentRunSteps).where(eq(agentRunSteps.runId, runId));
  if (texts.length === 0) return;
  await on.insert(agentRunSteps).values(
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

export async function addLog(runId: string, text: string, tx?: Tx): Promise<void> {
  await (tx ?? db).insert(agentRunLog).values({ runId, text: text.slice(0, 400) });
}

/**
 * Closes the run that handed this task on, so the next agent may claim it.
 *
 * The update names `ended_at is null` itself and returns the row, so two
 * claims that arrive together cannot both pass: one gets the row and the other
 * gets nothing and is told the task is held. That is the same lock the board
 * already has — the run — and not a second one. It takes the caller's
 * transaction, because closing this run and opening the next one is one act.
 *
 * It ends `done` and not `handed_over`, which loses the word the history row
 * would have read by. The alternative is worse: `isOpen()` answers true for
 * `handed_over`, so a run left in it would let the agent that walked away go
 * on reporting over the agent that now holds the task. A closed word of its
 * own is what this wants, and that is a change to `CLOSED_STATUSES` and every
 * reader of it, not to this line.
 */
export async function closeHandOver(
  tx: Tx,
  taskId: string,
  by: string,
): Promise<{ id: string; agentId: string } | null> {
  const [row] = await tx
    .update(agentRuns)
    .set({ status: "done", control: null, endedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agentRuns.taskId, taskId),
        isNull(agentRuns.endedAt),
        eq(agentRuns.status, "handed_over"),
      ),
    )
    .returning({ id: agentRuns.id, agentId: agentRuns.agentId });

  if (!row) return null;
  await addLog(row.id, `${by} picked the task up, so the hand-over is done`, tx);
  return row;
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
