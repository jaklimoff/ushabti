import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { attachments, projects } from "@/db/schema";
import { removeObjects } from "@/lib/attachment-rows";
import { HttpError } from "@/lib/auth";
import {
  body,
  broadcast,
  clientIdOf,
  guard,
  json,
  adminOnly,
  ownerOnly,
  route,
  str,
} from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { AGENT_RULES_MAX } from "@/lib/agent-rules";
import { rulesHash } from "@/lib/agent-rules-hash";
import { isTimeZone, zoneRefused } from "@/lib/day";
import { readDoneWhen } from "@/lib/links";
import { readProgressBy } from "@/lib/progress";
import { readTypeBy } from "@/lib/when";
import { loadProperties } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "change the project");

  const input = await body<{
    name?: string;
    key?: string;
    doneWhen?: unknown;
    progressBy?: unknown;
    typeBy?: unknown;
    timeZone?: string;
    publicChangelog?: unknown;
    agentRules?: unknown;
  }>(req);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = str(input.name, "Project name", { max: 80 });
  if (input.key !== undefined) {
    const key = str(input.key, "Project key", { max: 6 })
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!key) throw new HttpError(400, "The project key needs at least one letter or digit.");
    patch.key = key;
  }
  /*
   * What this project calls done, which is what makes a blocker stop
   * blocking. It goes through `readDoneWhen` on the way in, so a row that
   * names a property or an option that is gone never lands — and it is read
   * afresh on the way out as well, because one may go afterwards. Null is
   * "archived", which is the answer until somebody says otherwise.
   */
  if (input.doneWhen !== undefined) {
    patch.doneWhen = input.doneWhen
      ? readDoneWhen(input.doneWhen, await loadProperties(projectId))
      : null;
  }
  /*
   * The number property a column's bar sums. A name that is not a number
   * property of this project is refused rather than swallowed: a save that
   * quietly became "count tasks" would move every bar and say nothing.
   */
  if (input.progressBy !== undefined) {
    if (input.progressBy === null || input.progressBy === "") {
      patch.progressBy = null;
    } else {
      const id = readProgressBy(input.progressBy, await loadProperties(projectId));
      if (!id) throw new HttpError(400, "Progress can only be counted by a number property.");
      patch.progressBy = id;
    }
  }
  /*
   * The select whose options are this project's types. Refused as
   * `progressBy` is: a save that quietly became "no Type" would empty the
   * Types page and say nothing.
   */
  if (input.typeBy !== undefined) {
    if (input.typeBy === null || input.typeBy === "") {
      patch.typeBy = null;
    } else {
      const id = readTypeBy(input.typeBy, await loadProperties(projectId));
      if (!id) throw new HttpError(400, "Types can only come from a select property.");
      patch.typeBy = id;
    }
  }
  /*
   * The zone this project's day is worked out in, which is what a relative
   * date rule means by "today". A name the runtime does not know is refused
   * here with one sentence rather than written and swallowed by the fallback
   * on the way out: a zone that silently became UTC would move every card on
   * a "due this week" board and say nothing.
   */
  if (input.timeZone !== undefined) {
    const zone = str(input.timeZone, "Time zone", { max: 60 });
    if (!isTimeZone(zone)) throw new HttpError(400, zoneRefused(zone));
    patch.timeZone = zone;
  }
  /* Whether the changelog answers strangers. `adminOnly` above already keeps
     it a person's, which it must be: it hands out a read of the project. */
  if (input.publicChangelog !== undefined) {
    if (typeof input.publicChangelog !== "boolean") {
      throw new HttpError(400, "Public changelog is on or off.");
    }
    patch.publicChangelog = input.publicChangelog;
  }
  /* The rules an agent obeys on this board. `adminOnly` above keeps them a
     person's: an agent must not write its own rules. */
  let rules: string | null = null;
  if (input.agentRules !== undefined) {
    if (typeof input.agentRules !== "string") {
      throw new HttpError(400, "The agent rules are text.");
    }
    rules = input.agentRules.trim();
    if (rules.length > AGENT_RULES_MAX) {
      throw new HttpError(400, `The agent rules can be at most ${AGENT_RULES_MAX} characters.`);
    }
  }
  if (Object.keys(patch).length === 0 && rules === null) return json({ ok: true });

  try {
    if (Object.keys(patch).length > 0) {
      await db.update(projects).set(patch).where(eq(projects.id, projectId));
    }
  } catch (err) {
    /* One address, one project: the index lets one project per key be
       public, and a turn-on or a rename that would make two is refused. */
    if (!isPublicKeyTaken(err)) throw err;
    const [row] = await db
      .select({ key: projects.key })
      .from(projects)
      .where(eq(projects.id, projectId));
    const key = (patch.key as string | undefined) ?? row?.key ?? "";
    throw new HttpError(409, `Another project with the key ${key} already has a public changelog.`);
  }
  /*
   * The rules are written only where they differ, and the line follows only a
   * row that changed. Two admins saving the same words, or one blur that
   * changed nothing, write no line, so each line is one version an agent may
   * have been given. The line holds the words, because the row keeps only the
   * newest.
   */
  if (rules !== null) {
    const changed = await db
      .update(projects)
      .set({ agentRules: rules })
      .where(and(eq(projects.id, projectId), ne(projects.agentRules, rules)))
      .returning({ id: projects.id });
    if (changed.length > 0) {
      await logActivity({
        projectId,
        taskId: null,
        actorId: user.id,
        kind: "rules",
        data: { hash: rulesHash(rules), text: rules },
      });
    }
  }
  await broadcast({ projectId, scope: "project", clientId: clientIdOf(req) });
  return json({ ok: true });
});

function isPublicKeyTaken(err: unknown): boolean {
  for (let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined; e;) {
    if (e.code === "23505" && e.constraint === "projects_public_changelog_key") return true;
    e = e.cause as typeof e;
  }
  return false;
}

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "delete the project");
  /* The cascade would take the file rows and leave their objects behind, so
     the rows go first, in the same transaction, and the bucket after it. */
  const keys = await db.transaction(async (tx) => {
    const files = await tx
      .delete(attachments)
      .where(eq(attachments.projectId, projectId))
      .returning({ key: attachments.key });
    await tx.delete(projects).where(eq(projects.id, projectId));
    return files.map((f) => f.key);
  });
  removeObjects(keys);
  return json({ ok: true });
});
