/**
 * Creates a demo account with a filled board, so a fresh checkout has
 * something to look at. Safe to run more than once: it removes the demo
 * project first and leaves every other account alone.
 */
import { and, eq } from "drizzle-orm";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { db, pool } from "./index";
import {
  checklistItems,
  comments,
  projectMembers,
  projects,
  properties,
  propertyOptions,
  taskValues,
  tasks,
  users,
} from "./schema";
import { DEFAULT_PROPERTIES, DEFAULT_VIEWS } from "../lib/defaults";
import { rankSequence } from "../lib/rank";
import { views } from "./schema";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

async function hash(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

const PEOPLE = [
  { email: "demo@ushabti.local", name: "Demo Owner", color: "#6d5bd0" },
  { email: "friend@ushabti.local", name: "Second Person", color: "#2f9e7a" },
];

const SEED_TASKS: {
  title: string;
  status: string;
  priority: string;
  phase: string;
  estimate: string;
  labels: string[];
  who: number;
  due?: string;
  description?: string;
  checklist?: string[];
  comment?: string;
}[] = [
  {
    title: "Custom properties: select, multi-select, person, date",
    status: "Shipped",
    priority: "Urgent",
    phase: "PoC",
    estimate: "L",
    labels: ["feature", "infra"],
    who: 0,
    description:
      "Status and Priority are ordinary rows in the property table. Nothing about a task is written into the code.",
  },
  {
    title: "Board grouped by any property you choose",
    status: "Ready",
    priority: "High",
    phase: "MVP",
    estimate: "L",
    labels: ["feature"],
    who: 0,
    due: "2026-08-28",
    description: "A view stores one grouping property. The columns follow its options, in order.",
  },
  {
    title: "Drag and drop that feels right",
    status: "In Progress",
    priority: "Urgent",
    phase: "MVP",
    estimate: "M",
    labels: ["ux"],
    who: 1,
    due: "2026-08-25",
    description:
      "The card under the cursor is a real element with a shadow. Its neighbours slide out of the way. One drop writes one row.",
    checklist: [
      "The card follows the cursor exactly",
      "Cards below the gap slide down",
      "The drop lands where the gap was",
      "A cancelled drag puts everything back",
    ],
    comment: "Auto-scroll near the edge of the board still needs a look on a small screen.",
  },
  {
    title: "Live updates over server-sent events",
    status: "In Progress",
    priority: "High",
    phase: "MVP",
    estimate: "M",
    labels: ["infra"],
    who: 0,
    description: "Postgres LISTEN / NOTIFY fans a change out to every open board.",
  },
  {
    title: "Invite a friend by email",
    status: "Todo",
    priority: "Medium",
    phase: "MVP",
    estimate: "S",
    labels: ["feature"],
    who: 1,
    due: "2026-09-02",
  },
  {
    title: "Filter and sort inside a view",
    status: "Backlog",
    priority: "Medium",
    phase: "MMP",
    estimate: "M",
    labels: ["feature"],
    who: 0,
  },
  {
    title: "Keyboard shortcuts for the board",
    status: "Backlog",
    priority: "Low",
    phase: "MMP",
    estimate: "S",
    labels: ["ux"],
    who: 1,
  },
  {
    title: "Import a Trello board",
    status: "Todo",
    priority: "Low",
    phase: "Pilot",
    estimate: "L",
    labels: ["feature"],
    who: 0,
  },
  {
    title: "Archive instead of delete",
    status: "Backlog",
    priority: "Low",
    phase: "GA",
    estimate: "S",
    labels: [],
    who: 1,
  },
];

async function main() {
  const people: { id: string }[] = [];

  for (const person of PEOPLE) {
    const [existing] = await db.select().from(users).where(eq(users.email, person.email)).limit(1);
    if (existing) {
      people.push({ id: existing.id });
      continue;
    }
    const [created] = await db
      .insert(users)
      .values({
        email: person.email,
        name: person.name,
        color: person.color,
        passwordHash: await hash("ushabti-demo"),
      })
      .returning({ id: users.id });
    people.push(created);
  }

  const owner = people[0];

  // start from a clean demo project every time
  const old = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.ownerId, owner.id), eq(projects.key, "USH")));
  for (const row of old) await db.delete(projects).where(eq(projects.id, row.id));

  const [project] = await db
    .insert(projects)
    .values({ name: "Ushabti roadmap", key: "USH", ownerId: owner.id })
    .returning();

  await db.insert(projectMembers).values(
    people.map((p, i) => ({
      projectId: project.id,
      userId: p.id,
      role: i === 0 ? "owner" : "member",
    })),
  );

  const propRanks = rankSequence(DEFAULT_PROPERTIES.length);
  const propByName = new Map<string, string>();
  const optionByName = new Map<string, string>();

  for (let i = 0; i < DEFAULT_PROPERTIES.length; i += 1) {
    const def = DEFAULT_PROPERTIES[i];
    const [prop] = await db
      .insert(properties)
      .values({
        projectId: project.id,
        name: def.name,
        type: def.type,
        position: propRanks[i],
        config: { showOnCard: def.showOnCard },
      })
      .returning({ id: properties.id });
    propByName.set(def.name, prop.id);

    if (def.options?.length) {
      const ranks = rankSequence(def.options.length);
      const rows = await db
        .insert(propertyOptions)
        .values(
          def.options.map((o, j) => ({
            propertyId: prop.id,
            name: o.name,
            color: o.color,
            position: ranks[j],
          })),
        )
        .returning({ id: propertyOptions.id, name: propertyOptions.name });
      for (const row of rows) optionByName.set(`${def.name}:${row.name}`, row.id);
    }
  }

  const viewRanks = rankSequence(DEFAULT_VIEWS.length);
  await db.insert(views).values(
    DEFAULT_VIEWS.map((v, i) => ({
      projectId: project.id,
      name: v.name,
      groupById: propByName.get(v.groupBy) ?? null,
      position: viewRanks[i],
      isDefault: v.isDefault,
      config: {},
    })),
  );

  const taskRanks = rankSequence(SEED_TASKS.length);

  for (let i = 0; i < SEED_TASKS.length; i += 1) {
    const t = SEED_TASKS[i];
    const [task] = await db
      .insert(tasks)
      .values({
        projectId: project.id,
        number: i + 1,
        title: t.title,
        description: t.description ?? "",
        position: taskRanks[i],
        createdBy: people[t.who].id,
      })
      .returning({ id: tasks.id });

    const values: { propertyId: string; value: unknown }[] = [
      { propertyId: propByName.get("Status")!, value: optionByName.get(`Status:${t.status}`) },
      {
        propertyId: propByName.get("Priority")!,
        value: optionByName.get(`Priority:${t.priority}`),
      },
      { propertyId: propByName.get("Phase")!, value: optionByName.get(`Phase:${t.phase}`) },
      {
        propertyId: propByName.get("Estimate")!,
        value: optionByName.get(`Estimate:${t.estimate}`),
      },
      { propertyId: propByName.get("Assignee")!, value: people[t.who].id },
      {
        propertyId: propByName.get("Labels")!,
        value: t.labels.map((l) => optionByName.get(`Labels:${l}`)),
      },
    ];
    if (t.due) values.push({ propertyId: propByName.get("Due")!, value: t.due });

    await db.insert(taskValues).values(values.map((v) => ({ taskId: task.id, ...v })));

    if (t.checklist?.length) {
      const ranks = rankSequence(t.checklist.length);
      await db.insert(checklistItems).values(
        t.checklist.map((text, j) => ({
          taskId: task.id,
          text,
          done: j === 0,
          position: ranks[j],
        })),
      );
    }

    if (t.comment) {
      await db.insert(comments).values({
        taskId: task.id,
        authorId: people[(t.who + 1) % people.length].id,
        body: t.comment,
      });
    }
  }

  await db
    .update(projects)
    .set({ taskCounter: SEED_TASKS.length })
    .where(eq(projects.id, project.id));

  console.log("Seeded the demo project.");
  console.log("  Sign in with demo@ushabti.local / ushabti-demo");
  console.log("  Second account:  friend@ushabti.local / ushabti-demo");
}

await main();
await pool.end();
