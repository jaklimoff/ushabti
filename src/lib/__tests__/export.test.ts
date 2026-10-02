import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  checklistItems,
  comments,
  projectInvites,
  projectMembers,
  projects,
  properties,
  propertyOptions,
  taskLinks,
  taskValues,
  tasks,
  views,
} from "@/db/schema";

/**
 * The file an admin takes away.
 *
 * The fake answers each read by the table it came from, and it hands back
 * more than was asked for: a member row that still carries its password hash,
 * a project row with a webhook secret on it. The export has to pick what it
 * writes, because a row that grows a column must not grow the file with it.
 *
 * It also counts the reads, because the cost of the file is part of it: a
 * project of a thousand tasks must not cost a thousand round-trips.
 */
const fake = vi.hoisted(() => {
  type Builder = {
    from: (table: unknown) => Builder;
    innerJoin: () => Builder;
    where: (clause: unknown) => Builder;
    orderBy: () => Builder;
    limit: () => Builder;
    then: (ok: (rows: unknown[]) => unknown, fail?: (e: unknown) => unknown) => Promise<unknown>;
  };
  let reads = 0;
  const rows = new Map<unknown, unknown[]>();
  /** The condition each read was asked with, by the table it came from. */
  const wheres = new Map<unknown, unknown>();
  const builder = (): Builder => {
    let table: unknown = null;
    const node: Builder = {
      from: (t) => {
        table = t;
        return node;
      },
      innerJoin: () => node,
      where: (clause) => {
        wheres.set(table, clause);
        return node;
      },
      orderBy: () => node,
      limit: () => node,
      then: (ok, fail) => Promise.resolve(rows.get(table) ?? []).then(ok, fail),
    };
    return node;
  };
  return {
    db: {
      select: () => {
        reads += 1;
        return builder();
      },
    },
    rows,
    wheres,
    reads: () => reads,
    reset: () => {
      reads = 0;
      rows.clear();
      wheres.clear();
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));

const { exportFileName, loadExport } = await import("../export");

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const BOT = "33333333-3333-4333-8333-333333333333";
const STATUS = "44444444-4444-4444-8444-444444444444";
const DOING = "55555555-5555-4555-8555-555555555555";
const DONE = "66666666-6666-4666-8666-666666666666";
const VIEW = "77777777-7777-4777-8777-777777777777";

const HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2VjcmV0$aGFzaA";
const HOOK_SECRET = "whsec_do-not-leak";
const AT = new Date("2026-09-29T10:00:00.000Z");

function taskId(n: number) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
}

/** A project with `count` tasks. The second one is archived. */
function fill(count: number) {
  fake.reset();
  fake.rows.set(projects, [
    {
      id: PROJECT,
      name: "Ushabti",
      key: "USH",
      ownerId: ADA,
      taskCounter: count,
      cardView: null,
      doneWhen: { propertyId: STATUS, optionId: DONE },
      timeZone: "Europe/Berlin",
      createdAt: AT,
      webhookSecret: HOOK_SECRET,
    },
  ]);
  fake.rows.set(projectMembers, [
    {
      id: ADA,
      name: "Ada",
      email: "ada@example.com",
      kind: "human",
      color: "#6d5bd0",
      role: "owner",
      passwordHash: HASH,
    },
    {
      id: BOT,
      name: "Bot",
      email: null,
      kind: "agent",
      color: "#1f9d55",
      role: "member",
      passwordHash: null,
      tokenHash: "ush_live_do-not-leak",
    },
  ]);
  fake.rows.set(projectInvites, [
    { email: "new@example.com", invitedBy: ADA, createdAt: AT, token: "invite-do-not-leak" },
  ]);
  fake.rows.set(properties, [
    {
      id: STATUS,
      projectId: PROJECT,
      name: "Status",
      type: "select",
      position: "a0",
      config: {},
      createdAt: AT,
    },
  ]);
  fake.rows.set(propertyOptions, [
    { id: DOING, propertyId: STATUS, name: "Doing", color: "#f00", position: "a0" },
    { id: DONE, propertyId: STATUS, name: "Done", color: "#0f0", position: "a1" },
  ]);
  fake.rows.set(views, [
    {
      id: VIEW,
      projectId: PROJECT,
      name: "Board",
      kind: "board",
      groupById: STATUS,
      position: "a0",
      isDefault: true,
      config: {
        filters: { rules: [{ id: "r1", propertyId: STATUS, op: "is", values: [DOING] }] },
        sort: { columnId: "_title", direction: "asc" },
      },
      cardView: { rows: { [STATUS]: { place: "footerL", mode: "text" } } },
    },
  ]);
  const taskRows = Array.from({ length: count }, (_, i) => ({
    id: taskId(i + 1),
    number: i + 1,
    title: `Task ${i + 1}`,
    description: "",
    position: `a${i}`,
    createdBy: ADA,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: i === 1 ? AT : null,
    deletedAt: null,
  }));
  fake.rows.set(tasks, taskRows);
  fake.rows.set(
    taskValues,
    taskRows.map((t) => ({ taskId: t.id, propertyId: STATUS, value: DOING })),
  );
  fake.rows.set(checklistItems, [
    { id: "c1", taskId: taskId(1), text: "Write the test", done: true, position: "a0" },
  ]);
  fake.rows.set(comments, [
    {
      id: "m1",
      taskId: taskId(1),
      authorId: BOT,
      body: "Started.",
      createdAt: AT,
      editedAt: null,
    },
  ]);
  fake.rows.set(taskLinks, [{ fromId: taskId(2), toId: taskId(1), kind: "blocks" }]);
}

beforeEach(() => fill(3));

describe("the export", () => {
  it("says what it is", async () => {
    const file = await loadExport(PROJECT, AT);
    expect(file.format).toBe("ushabti-export");
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe(AT.toISOString());
    expect(file.project).toMatchObject({
      name: "Ushabti",
      key: "USH",
      timeZone: "Europe/Berlin",
      doneWhen: { propertyId: STATUS, optionId: DONE },
    });
    expect(file.project.cardView.rows).toBeTruthy();
  });

  it("holds the properties with their options in order", async () => {
    const file = await loadExport(PROJECT, AT);
    expect(file.properties).toHaveLength(1);
    expect(file.properties[0].id).toBe(STATUS);
    expect(file.properties[0].options.map((o) => o.id)).toEqual([DOING, DONE]);
  });

  it("holds the team's filters and sort of a view", async () => {
    const file = await loadExport(PROJECT, AT);
    expect(file.views[0]).toMatchObject({
      id: VIEW,
      name: "Board",
      kind: "board",
      groupById: STATUS,
      isDefault: true,
      sort: { columnId: "_title", direction: "asc" },
    });
    expect(file.views[0].filters.rules).toHaveLength(1);
    expect(file.views[0]).not.toHaveProperty("lens");
  });

  it("holds a view's own card view, read as the board reads it", async () => {
    const file = await loadExport(PROJECT, AT);
    expect(file.views[0].cardView?.rows[STATUS]).toEqual({ place: "footerL", mode: "text" });
    expect(file.views[0].cardView?.rows._title).toEqual({ place: "title", mode: "fixed" });
  });

  it("holds the members and the invites", async () => {
    const file = await loadExport(PROJECT, AT);
    expect(file.members).toEqual([
      {
        id: ADA,
        name: "Ada",
        email: "ada@example.com",
        kind: "human",
        role: "owner",
        color: "#6d5bd0",
      },
      { id: BOT, name: "Bot", email: null, kind: "agent", role: "member", color: "#1f9d55" },
    ]);
    expect(file.invites).toEqual([{ email: "new@example.com" }]);
  });

  it("holds a live and an archived task with their values, checklist, comments and blockers", async () => {
    const file = await loadExport(PROJECT, AT);
    const [first, second] = file.tasks;
    expect(first).toMatchObject({
      key: "USH-1",
      number: 1,
      title: "Task 1",
      rank: "a0",
      createdBy: ADA,
      archivedAt: null,
      values: { [STATUS]: DOING },
      checklist: [{ text: "Write the test", done: true }],
      comments: [{ authorId: BOT, body: "Started.", createdAt: AT.toISOString() }],
      blockedBy: ["USH-2"],
    });
    expect(second).toMatchObject({ key: "USH-2", archivedAt: AT.toISOString(), blockedBy: [] });
  });

  /* The ids a value or an author names are the ids the file lists. */
  it("names only ids it also lists", async () => {
    const file = await loadExport(PROJECT, AT);
    const propertyIds = new Set(file.properties.map((p) => p.id));
    const optionIds = new Set(file.properties.flatMap((p) => p.options.map((o) => o.id)));
    const memberIds = new Set(file.members.map((m) => m.id));
    for (const task of file.tasks) {
      for (const [propertyId, value] of Object.entries(task.values)) {
        expect(propertyIds.has(propertyId)).toBe(true);
        expect(optionIds.has(value as string)).toBe(true);
      }
      if (task.createdBy) expect(memberIds.has(task.createdBy)).toBe(true);
      for (const c of task.comments) if (c.authorId) expect(memberIds.has(c.authorId)).toBe(true);
    }
  });

  it("lets no secret out", async () => {
    const text = JSON.stringify(await loadExport(PROJECT, AT));
    expect(text).not.toContain(HASH);
    expect(text).not.toContain(HOOK_SECRET);
    expect(text).not.toContain("do-not-leak");
    expect(text).not.toMatch(/password|token|session|reset|webhook|secret/i);
  });

  /* The fake cannot run SQL, so the condition itself is read: every read of
     a task, or of a row that hangs off one, leaves a deleted task out. */
  it("leaves out a deleted task and everything that hangs off it", async () => {
    await loadExport(PROJECT, AT);
    const dialect = new PgDialect();
    for (const table of [tasks, taskValues, checklistItems, comments, taskLinks]) {
      const clause = fake.wheres.get(table) as SQL;
      expect(clause).toBeTruthy();
      expect(dialect.sqlToQuery(clause).sql).toContain('"tasks"."deleted_at" is null');
    }
  });

  it("makes the same number of reads for three tasks and for three hundred", async () => {
    await loadExport(PROJECT, AT);
    const few = fake.reads();
    fill(300);
    const file = await loadExport(PROJECT, AT);
    expect(file.tasks).toHaveLength(300);
    expect(fake.reads()).toBe(few);
  });
});

describe("the file name", () => {
  it("is the key and the project's day", () => {
    /* Late on the 29th in UTC is already the 30th in Tokyo. */
    const late = new Date("2026-09-29T20:00:00.000Z");
    expect(exportFileName("USH", "Asia/Tokyo", late)).toBe("ushabti-USH-2026-09-30.json");
    expect(exportFileName("USH", "UTC", late)).toBe("ushabti-USH-2026-09-29.json");
  });
});
