import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, propertyOptions, properties, views } from "@/db/schema";
import { byPos } from "./order";
import { HttpError } from "./auth";
import { copySetup, summarize, type Setup, type SetupSummary } from "./setup-copy";
import type { Tx } from "./queries";

/*
 * The reads and the write around `copySetup`. A source is only ever read, and
 * only for a person who is a member of it: any other id answers as a project
 * that does not exist, so the answer says nothing about it.
 */

type Reader = Tx | typeof db;

async function readSetups(
  reader: Reader,
  ids: string[],
): Promise<Map<string, Setup & { project: Setup["project"] & { name: string } }>> {
  const out = new Map<string, Setup & { project: Setup["project"] & { name: string } }>();
  if (ids.length === 0) return out;
  const [rows, props, viewRows] = await Promise.all([
    reader.select().from(projects).where(inArray(projects.id, ids)),
    reader
      .select({
        id: properties.id,
        projectId: properties.projectId,
        name: properties.name,
        type: properties.type,
        position: properties.position,
        config: properties.config,
      })
      .from(properties)
      .where(inArray(properties.projectId, ids))
      .orderBy(byPos(properties.position)),
    reader
      .select({
        projectId: views.projectId,
        name: views.name,
        kind: views.kind,
        groupById: views.groupById,
        position: views.position,
        isDefault: views.isDefault,
        config: views.config,
        cardView: views.cardView,
      })
      .from(views)
      .where(inArray(views.projectId, ids))
      .orderBy(byPos(views.position)),
  ]);
  const options = props.length
    ? await reader
        .select({
          id: propertyOptions.id,
          propertyId: propertyOptions.propertyId,
          name: propertyOptions.name,
          color: propertyOptions.color,
          icon: propertyOptions.icon,
          position: propertyOptions.position,
        })
        .from(propertyOptions)
        .where(
          inArray(
            propertyOptions.propertyId,
            props.map((p) => p.id),
          ),
        )
        .orderBy(byPos(propertyOptions.position))
    : [];
  const projectOf = new Map(props.map((p) => [p.id, p.projectId]));

  for (const row of rows) {
    out.set(row.id, {
      project: {
        name: row.name,
        cardView: row.cardView,
        doneWhen: row.doneWhen,
        progressBy: row.progressBy,
        typeBy: row.typeBy,
        releaseBy: row.releaseBy,
        sprintBy: row.sprintBy,
        agentRules: row.agentRules,
      },
      properties: props.filter((p) => p.projectId === row.id).map(({ projectId: _, ...p }) => p),
      options: options.filter((o) => projectOf.get(o.propertyId) === row.id),
      views: viewRows.filter((v) => v.projectId === row.id).map(({ projectId: _, ...v }) => v),
    });
  }
  return out;
}

/**
 * Writes the setup of `fromId` into the project just made, inside the
 * transaction that made it. A source the person is not a member of throws
 * 404, which takes the new project back out with it.
 */
export async function writeSetupFrom(
  tx: Tx,
  userId: string,
  projectId: string,
  fromId: string,
): Promise<void> {
  const [member] = await tx
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, fromId), eq(projectMembers.userId, userId)));
  if (!member) throw new HttpError(404, "Project not found.");

  const source = (await readSetups(tx, [fromId])).get(fromId);
  if (!source) throw new HttpError(404, "Project not found.");
  const copy = copySetup(source, () => crypto.randomUUID());

  if (copy.properties.length) {
    await tx.insert(properties).values(
      copy.properties.map((p) => ({
        id: p.id,
        projectId,
        name: p.name,
        type: p.type,
        position: p.position,
        config: p.config ?? {},
      })),
    );
  }
  if (copy.options.length) {
    await tx.insert(propertyOptions).values(copy.options);
  }
  if (copy.views.length) {
    await tx.insert(views).values(
      copy.views.map((v) => ({
        projectId,
        name: v.name,
        kind: v.kind,
        groupById: v.groupById,
        position: v.position,
        isDefault: v.isDefault,
        config: v.config ?? {},
        cardView: v.cardView,
      })),
    );
  }
  await tx
    .update(projects)
    .set({
      cardView: copy.project.cardView,
      doneWhen: copy.project.doneWhen,
      progressBy: copy.project.progressBy,
      typeBy: copy.project.typeBy,
      releaseBy: copy.project.releaseBy,
      sprintBy: copy.project.sprintBy,
      agentRules: copy.project.agentRules,
    })
    .where(eq(projects.id, projectId));
}

/** What each project of a person would bring to a new one, by id. */
export async function setupSummaries(projectIds: string[]): Promise<Map<string, SetupSummary>> {
  const setups = await readSetups(db, projectIds);
  return new Map([...setups].map(([id, s]) => [id, summarize(s)]));
}
