import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db, pool } = await import("@/db");
const { activity, projects } = await import("@/db/schema");
const { agent, api, board, join, ok, person, project, task } = await import("@/test/route");
const { loadCharts } = await import("@/lib/charts-load");
const { boardsOnce } = await import("@/lib/lists-load");
const { listProjects } = await import("@/lib/queries");
const { dayBefore } = await import("@/lib/charts");

/*
 * What a chart counts, and whom it answers. It counts the feed by option id
 * and by the day in the project's zone, and it is one person's alone.
 */

type Who = Awaited<ReturnType<typeof person>>;
type Property = { id: string; name: string; options: { id: string; name: string }[] };

async function shape(who: Who, projectId: string) {
  const b = await board(who, projectId);
  const property = (name: string) => (b.properties as Property[]).find((p) => p.name === name)!;
  const option = (prop: string, name: string) =>
    property(prop).options.find((o) => o.name === name)!.id;
  return { property, option, today: b.today as string };
}

async function addChart(who: Who, projectId: string, propertyId: string, optionId: string) {
  const { chart } = await ok<{ chart: { id: string } }>(
    api(who).post("/api/charts", { projectId, propertyId, optionId }),
  );
  return chart;
}

async function chartsFor(who: Who) {
  const rows = await listProjects(who.id);
  return (await loadCharts(who.id, rows, boardsOnce(who.id))).charts;
}

const set = (who: Who, taskId: string, propertyId: string, value: string) =>
  ok(api(who).put(`/api/tasks/${taskId}/values/${propertyId}`, { value }));

describe("A chart", () => {
  it("counts a task made with the option, and one that entered it twice in a day", async () => {
    const me = await person("Pace Watcher");
    const p = await project(me);
    const { property, option, today } = await shape(me, p.id);
    const status = property("Status").id;
    const doing = option("Status", "In Progress");

    await ok(
      api(me).post(`/api/projects/${p.id}/tasks`, {
        title: "Born in progress",
        values: { [status]: doing },
      }),
    );
    const t = await task(me, p.id, "Back and forth");
    await set(me, t.id, status, doing);
    await set(me, t.id, status, option("Status", "Todo"));
    await set(me, t.id, status, doing);
    // Another option, and another select, count nothing here.
    await set(me, t.id, status, option("Status", "Shipped"));
    await set(me, t.id, property("Priority").id, option("Priority", "High"));

    await addChart(me, p.id, status, doing);
    const [chart] = await chartsFor(me);
    expect(chart.option).toBe("In Progress");
    expect(chart.days).toHaveLength(30);
    expect(chart.days.at(-1)).toEqual({ day: today, count: 3 });
    expect(chart.days.slice(0, -1).every((d) => d.count === 0)).toBe(true);
  });

  it("counts by the day in the project's zone, over the last thirty days", async () => {
    const me = await person("Zone Reader");
    const p = await project(me);
    await db.update(projects).set({ timeZone: "Asia/Tokyo" }).where(eq(projects.id, p.id));
    const { property, option, today } = await shape(me, p.id);
    const status = property("Status").id;
    const done = option("Status", "Shipped");
    const t = await task(me, p.id, "Shipped a while ago");
    const line = (at: string) => ({
      projectId: p.id,
      taskId: t.id,
      kind: "value",
      data: { propertyId: status, type: "select", value: "Shipped", optionId: done },
      createdAt: new Date(at),
    });
    const three = dayBefore(today, 3);
    await db.insert(activity).values([
      // 23:00 in Tokyo, so three days ago there.
      line(`${three}T14:00:00Z`),
      // 05:00 the next morning in Tokyo, though still that day in UTC.
      line(`${three}T20:00:00Z`),
      line(`${three}T21:00:00Z`),
      // Noon in Tokyo thirty days ago, one day before the chart starts.
      line(`${dayBefore(today, 30)}T03:00:00Z`),
    ]);

    await addChart(me, p.id, status, done);
    const [chart] = await chartsFor(me);
    expect(chart.days[0].day).toBe(dayBefore(today, 29));
    const counted = chart.days.filter((d) => d.count > 0);
    expect(counted).toEqual([
      { day: three, count: 1 },
      { day: dayBefore(today, 2), count: 2 },
    ]);
  });

  it("reads the option by id, so a rename keeps the count and a line by name only is not counted", async () => {
    const me = await person("Renamer");
    const p = await project(me);
    const { property, option } = await shape(me, p.id);
    const status = property("Status").id;
    const ready = option("Status", "Ready");
    const t = await task(me, p.id, "Ready then renamed");
    await set(me, t.id, status, ready);
    await ok(api(me).patch(`/api/options/${ready}`, { name: "Waiting" }));
    await db.insert(activity).values({
      projectId: p.id,
      taskId: t.id,
      kind: "value",
      data: { propertyId: status, type: "select", value: "Waiting" },
    });

    await addChart(me, p.id, status, ready);
    const [chart] = await chartsFor(me);
    expect(chart.option).toBe("Waiting");
    expect(chart.days.at(-1)!.count).toBe(1);
  });

  it("answers 404 to another person and 403 to an agent", async () => {
    const me = await person("Owner Of Chart");
    const other = await person("Somebody Else");
    const p = await project(me);
    const { property, option } = await shape(me, p.id);
    const chart = await addChart(me, p.id, property("Status").id, option("Status", "Todo"));

    expect((await api(other).del(`/api/charts/${chart.id}`)).status).toBe(404);
    const bot = await agent(me, p.id);
    expect((await bot.api.del(`/api/charts/${chart.id}`)).status).toBe(403);
    const asked = await bot.api.post("/api/charts", {
      projectId: p.id,
      propertyId: property("Status").id,
      optionId: option("Status", "Todo"),
    });
    expect(asked.status).toBe(403);
    expect(await chartsFor(other)).toEqual([]);

    await ok(api(me).del(`/api/charts/${chart.id}`));
    expect(await chartsFor(me)).toEqual([]);
  });

  it("refuses a property that is not a select, and an option of another property", async () => {
    const me = await person("Picky");
    const p = await project(me);
    const { property, option } = await shape(me, p.id);
    const wrong = await api(me).post("/api/charts", {
      projectId: p.id,
      propertyId: property("Assignee").id,
      optionId: option("Status", "Todo"),
    });
    expect(wrong.status).toBe(400);
    const crossed = await api(me).post("/api/charts", {
      projectId: p.id,
      propertyId: property("Status").id,
      optionId: option("Priority", "High"),
    });
    expect(crossed.status).toBe(400);
  });

  it("is not drawn once its option or property is gone, or its project was left, and stays", async () => {
    const me = await person("Leaver");
    const owner = await person("Stayer");
    const p = await project(me);
    const { property, option } = await shape(me, p.id);
    await addChart(me, p.id, property("Status").id, option("Status", "Backlog"));
    await addChart(me, p.id, property("Priority").id, option("Priority", "Low"));
    await addChart(me, p.id, property("Phase").id, property("Phase").options[0].id);
    expect(await chartsFor(me)).toHaveLength(3);

    await ok(api(me).del(`/api/options/${option("Status", "Backlog")}`));
    await ok(api(me).del(`/api/properties/${property("Priority").id}`));
    expect((await chartsFor(me)).map((c) => c.property)).toEqual(["Phase"]);

    const q = await project(owner);
    await join(q.id, me, "member");
    const there = await shape(me, q.id);
    await addChart(me, q.id, there.property("Status").id, there.option("Status", "Todo"));
    expect(await chartsFor(me)).toHaveLength(2);
    await ok(api(me).del(`/api/projects/${q.id}/members/${me.id}`));
    expect(await chartsFor(me)).toHaveLength(1);
    const kept = await pool.query(`select count(*)::int as n from charts where user_id = $1`, [
      me.id,
    ]);
    expect((kept.rows[0] as { n: number }).n).toBe(4);
  });
});

describe("The migration", () => {
  it("gives an older line the id of the option that carries its name today, once", async () => {
    const me = await person("Old Lines");
    const p = await project(me);
    const { property, option } = await shape(me, p.id);
    const status = property("Status").id;
    const t = await task(me, p.id, "Has a history");
    const old = (value: string, propertyId = status) => ({
      projectId: p.id,
      taskId: t.id,
      kind: "value",
      data: { property: "Status", propertyId, type: "select", value },
    });
    const [matches, renamed, gone] = await db
      .insert(activity)
      .values([old("Ready"), old("Old name"), old("Ready", crypto.randomUUID())])
      .returning({ id: activity.id });

    const sql = readFileSync("drizzle/0030_charts.sql", "utf8");
    const backfill = sql.split("--> statement-breakpoint").at(-1)!;
    await pool.query(backfill);
    await pool.query(backfill);

    const dataOf = async (id: string) =>
      (await db.select().from(activity).where(eq(activity.id, id)))[0].data as Record<
        string,
        unknown
      >;
    expect((await dataOf(matches.id)).optionId).toBe(option("Status", "Ready"));
    expect(await dataOf(renamed.id)).not.toHaveProperty("optionId");
    expect(await dataOf(gone.id)).not.toHaveProperty("optionId");
  });
});
