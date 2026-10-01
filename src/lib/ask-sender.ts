import "server-only";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  agentRuns,
  comments,
  projectMembers,
  projects,
  properties,
  taskValues,
  tasks,
  users,
} from "@/db/schema";
import { addresseesOf, askLink, askMail, ASK_MAIL_AFTER_MS, questionOf } from "./ask-mail";
import { forgotConfig } from "./forgot";
import { sendMail } from "./mail";
import { byPos } from "./order";

type Env = Record<string, string | undefined>;

/**
 * How seldom the read path looks for an ask that is due. A busy board is read
 * many times a second, and the delay is fifteen minutes, so ten seconds late
 * is nothing and one look in ten seconds costs nothing.
 */
const LOOK_EVERY_MS = 10_000;

/**
 * One look at a time in this process, and no more than one in each ten
 * seconds. A flag and not a lock, as the webhook sender's is: a second
 * process could look at the same moment, and the claim below is what keeps
 * the email to one.
 */
const globalForAsks = globalThis as unknown as {
  __ushabtiAsking?: boolean;
  __ushabtiAskedAt?: number;
};

/**
 * Starts a look and does not wait for it. There is no timer: the board read
 * and the stream's own ping call this, as the board read starts the webhook
 * sender. An agent that waits for an answer holds the stream, so the look
 * happens even when no person has the board open.
 */
export function kickAskMail(): void {
  const now = Date.now();
  if (globalForAsks.__ushabtiAsking) return;
  if (now - (globalForAsks.__ushabtiAskedAt ?? 0) < LOOK_EVERY_MS) return;
  globalForAsks.__ushabtiAskedAt = now;
  void sendDueAsks().catch(() => {
    // An email must never reach the read that started it.
  });
}

/**
 * Sends one email for each ask that is due. Off unless mail is on and the
 * server knows its own address, as "Forgot password?" is: the link has to
 * open the task, and a request's `Host` is not here to build it from.
 *
 * Off, it reads nothing and writes nothing. Awaited only by its own tests.
 */
export async function sendDueAsks(
  now: () => Date = () => new Date(),
  env: Env = process.env,
): Promise<number> {
  const config = forgotConfig(env);
  if (!config.on) return 0;
  if (globalForAsks.__ushabtiAsking) return 0;
  globalForAsks.__ushabtiAsking = true;
  try {
    const cutoff = new Date(now().getTime() - ASK_MAIL_AFTER_MS);
    /* The claim is the "once". One statement marks every due ask before
       anything is sent, so a second look — in this process or another —
       finds nothing to take. An email lost on the way is not sent again;
       a second email is the thing the owner ruled out. The conditions are
       `isDue()`, asked of the rows. */
    const claimed = await db
      .update(agentRuns)
      .set({ askMailedAt: now() })
      .where(
        and(
          isNull(agentRuns.endedAt),
          eq(agentRuns.status, "waiting"),
          isNull(agentRuns.askMailedAt),
          lte(agentRuns.askedAt, cutoff),
          sql`exists (select 1 from ${tasks} where ${tasks.id} = ${agentRuns.taskId} and ${tasks.deletedAt} is null and ${tasks.archivedAt} is null)`,
          sql`not exists (select 1 from ${comments} inner join ${users} on ${users.id} = ${comments.authorId} where ${comments.taskId} = ${agentRuns.taskId} and ${users.kind} = 'human' and ${comments.createdAt} >= ${agentRuns.askedAt})`,
        ),
      )
      .returning({
        projectId: agentRuns.projectId,
        taskId: agentRuns.taskId,
        agentId: agentRuns.agentId,
        step: agentRuns.step,
        askedAt: agentRuns.askedAt,
      });

    let sent = 0;
    for (const ask of claimed) {
      try {
        sent += await sendOne(ask, config.origin, env);
      } catch (err) {
        // One ask that cannot be read must not keep the others from going out.
        console.error(`Could not email an ask: ${err instanceof Error ? err.message : err}`);
      }
    }
    return sent;
  } finally {
    globalForAsks.__ushabtiAsking = false;
  }
}

type Claimed = {
  projectId: string;
  taskId: string;
  agentId: string;
  step: string;
  askedAt: Date | null;
};

async function sendOne(ask: Claimed, origin: string, env: Env): Promise<number> {
  const [project, task, agent, props, valueRows, members, touchRows, agentComments] =
    await Promise.all([
      db
        .select({ name: projects.name, key: projects.key })
        .from(projects)
        .where(eq(projects.id, ask.projectId))
        .limit(1),
      db
        .select({ number: tasks.number, title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, ask.taskId))
        .limit(1),
      db.select({ name: users.name }).from(users).where(eq(users.id, ask.agentId)).limit(1),
      db
        .select({ id: properties.id, type: properties.type })
        .from(properties)
        .where(eq(properties.projectId, ask.projectId))
        .orderBy(byPos(properties.position)),
      db
        .select({ propertyId: taskValues.propertyId, value: taskValues.value })
        .from(taskValues)
        .where(eq(taskValues.taskId, ask.taskId)),
      db
        .select({
          id: users.id,
          kind: users.kind,
          role: projectMembers.role,
          email: users.email,
          askMail: users.askMail,
        })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, ask.projectId)),
      /* Who changed the task or commented on it. A comment writes a line in
         the feed too, so the feed answers both. Newest first; the rule in
         `addresseesOf` skips an agent and anybody who has left. */
      db
        .select({ actorId: activity.actorId })
        .from(activity)
        .innerJoin(users, eq(users.id, activity.actorId))
        .where(and(eq(activity.taskId, ask.taskId), eq(users.kind, "human")))
        .orderBy(desc(activity.createdAt))
        .limit(50),
      db
        .select({ body: comments.body })
        .from(comments)
        .where(
          and(
            eq(comments.taskId, ask.taskId),
            eq(comments.authorId, ask.agentId),
            ask.askedAt ? lte(comments.createdAt, ask.askedAt) : undefined,
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(5),
    ]);

  if (!project[0] || !task[0]) return 0;
  const key = `${project[0].key}-${task[0].number}`;
  const values: Record<string, unknown> = {};
  for (const row of valueRows) values[row.propertyId] = row.value;

  const to = addresseesOf({
    properties: props,
    values,
    members,
    touchers: touchRows.map((r) => r.actorId).filter((id): id is string => !!id),
  });

  let sent = 0;
  for (const person of to) {
    const ok = await sendMail(
      askMail({
        to: person.email ?? "",
        project: project[0].name,
        key,
        title: task[0].title,
        agent: agent[0]?.name ?? "An agent",
        question: questionOf(
          ask.step,
          agentComments.map((c) => c.body),
        ),
        link: askLink(origin, ask.projectId, key),
      }),
      env,
    );
    if (ok) sent += 1;
  }
  return sent;
}
