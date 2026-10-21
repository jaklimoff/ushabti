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
const { CHART_TWICE, dayBefore } = await import("@/lib/charts");
type ChartDTO = import("@/lib/charts").ChartDTO;

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
    await set(me, t.id, status, option("Status", "Done"));
    await set(me, t.id, property("Priority").id, option("Priority", "High"));

    await addChart(me, p.id, status, doing);
    const [chart] = await chartsFor(me);
    expect(chart.sources[0].option).toBe("In Progress");
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
    const done = option("Status", "Done");
    const t = await task(me, p.id, "Shipped a while ago");
    const line = (at: string) => ({
      projectId: p.id,
      taskId: t.id,
      kind: "value",
      data: { propertyId: status, type: "select", value: "Done", optionId: done },
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
    expect(chart.sources[0].option).toBe("Waiting");
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
    await addChart(me, p.id, property("Estimate").id, property("Estimate").options[0].id);
    expect(await chartsFor(me)).toHaveLength(3);

    await ok(api(me).del(`/api/options/${option("Status", "Backlog")}`));
    await ok(api(me).del(`/api/properties/${property("Priority").id}`));
    expect((await chartsFor(me)).map((c) => c.sources[0].property)).toEqual(["Estimate"]);

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

describe("A new chart", () => {
  it("is refused with 409 when the person already has it, and not for somebody else", async () => {
    const me = await person("Twice Asker");
    const other = await person("Same Chart Too");
    const p = await project(me);
    await join(p.id, other, "member");
    const { property, option } = await shape(me, p.id);
    const status = property("Status").id;
    const shipped = option("Status", "Done");
    await addChart(me, p.id, status, shipped);

    const again = await api(me).post("/api/charts", {
      projectId: p.id,
      propertyId: status,
      optionId: shipped,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe(CHART_TWICE);
    // Another column of the same select, and the same chart for another person, are new.
    await addChart(me, p.id, status, option("Status", "Todo"));
    await addChart(other, p.id, status, shipped);
    expect(await chartsFor(me)).toHaveLength(2);
  });

  it("is previewed with the very days the saved chart then draws", async () => {
    const me = await person("Previewer");
    const p = await project(me);
    const { property, option, today } = await shape(me, p.id);
    const status = property("Status").id;
    const doing = option("Status", "In Progress");
    const t = await task(me, p.id, "Moves along");
    await set(me, t.id, status, doing);
    await set(me, t.id, status, option("Status", "Todo"));
    await set(me, t.id, status, doing);

    const pick = { projectId: p.id, propertyId: status, optionId: doing };
    const { chart: preview } = await ok<{ chart: ChartDTO }>(
      api(me).post("/api/charts/preview", pick),
    );
    expect(preview.days.at(-1)).toEqual({ day: today, count: 2 });
    expect(await chartsFor(me)).toEqual([]);

    const made = await addChart(me, p.id, status, doing);
    const [saved] = await chartsFor(me);
    expect({ ...preview, id: made.id }).toEqual(saved);
  });

  it("is previewed only for a person in the project, and never for an agent", async () => {
    const me = await person("Preview Owner");
    const stranger = await person("Preview Stranger");
    const p = await project(me);
    const { property, option } = await shape(me, p.id);
    const pick = {
      projectId: p.id,
      propertyId: property("Status").id,
      optionId: option("Status", "Todo"),
    };
    expect((await api(stranger).post("/api/charts/preview", pick)).status).toBe(404);
    const bot = await agent(me, p.id);
    expect((await bot.api.post("/api/charts/preview", pick)).status).toBe(403);
    const crossed = { ...pick, optionId: option("Priority", "High") };
    expect((await api(me).post("/api/charts/preview", crossed)).status).toBe(400);
  });
});

describe("A chart of several projects", () => {
  async function twoProjects(name: string) {
    const me = await person(name);
    const p = await project(me);
    const q = await project(me);
    const here = await shape(me, p.id);
    const there = await shape(me, q.id);
    const pick = (where: typeof here, projectId: string, option: string) => ({
      projectId,
      propertyId: where.property("Status").id,
      optionId: where.option("Status", option),
    });
    return { me, p, q, here, there, pick };
  }

  it("draws one bar a day that is the sum of each project's count", async () => {
    const { me, p, q, here, there, pick } = await twoProjects("Two Boards");
    for (const title of ["One", "Two", "Three"]) {
      const t = await task(me, p.id, title);
      await set(me, t.id, here.property("Status").id, here.option("Status", "Done"));
    }
    for (const title of ["Four", "Five"]) {
      const t = await task(me, q.id, title);
      await set(me, t.id, there.property("Status").id, there.option("Status", "Done"));
    }
    const sources = [pick(here, p.id, "Done"), pick(there, q.id, "Done")];
    const { chart: preview } = await ok<{ chart: ChartDTO }>(
      api(me).post("/api/charts/preview", { sources }),
    );
    await ok(api(me).post("/api/charts", { sources }));
    const [chart] = await chartsFor(me);
    expect(chart.days.at(-1)).toEqual({ day: here.today, count: 5 });
    expect(chart.sources.map((s) => [s.project.key, s.days.at(-1)!.count])).toEqual([
      [p.key, 3],
      [q.key, 2],
    ]);
    expect({ ...preview, id: chart.id }).toEqual(chart);
  });

  it("refuses the same set in any order with 409, a project twice with 400, and a stranger's project", async () => {
    const { me, p, q, here, there, pick } = await twoProjects("Set Twice");
    const a = pick(here, p.id, "Done");
    const b = pick(there, q.id, "Done");
    await ok(api(me).post("/api/charts", { sources: [a, b] }));
    const again = await api(me).post("/api/charts", { sources: [b, a] });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe(CHART_TWICE);
    // One of the two alone is another chart.
    await ok(api(me).post("/api/charts", { sources: [a] }));
    const doubled = await api(me).post("/api/charts", {
      sources: [a, pick(here, p.id, "Todo")],
    });
    expect(doubled.status).toBe(400);

    const stranger = await person("Not In Q");
    const theirs = await project(stranger);
    const far = await shape(stranger, theirs.id);
    const out = await api(me).post("/api/charts", {
      sources: [a, pick(far, theirs.id, "Done")],
    });
    expect(out.status).toBe(404);
    const peek = await api(me).post("/api/charts/preview", {
      sources: [a, pick(far, theirs.id, "Done")],
    });
    expect(peek.status).toBe(404);
    expect(await chartsFor(me)).toHaveLength(2);
  });

  it("counts nothing of a project the person left, and keeps the source", async () => {
    const owner = await person("Keeps Q");
    const { me, p, here, pick } = await twoProjects("Leaves Q");
    const q = await project(owner);
    await join(q.id, me, "member");
    const there = await shape(me, q.id);
    const t = await task(owner, q.id, "Done over there");
    await set(owner, t.id, there.property("Status").id, there.option("Status", "Done"));
    await ok(
      api(me).post("/api/charts", {
        sources: [pick(here, p.id, "Done"), pick(there, q.id, "Done")],
      }),
    );
    expect((await chartsFor(me))[0].days.at(-1)!.count).toBe(1);

    await ok(api(me).del(`/api/projects/${q.id}/members/${me.id}`));
    const [chart] = await chartsFor(me);
    expect(chart.sources.map((s) => s.project.key)).toEqual([p.key]);
    expect(chart.days.at(-1)!.count).toBe(0);
    const kept = await pool.query(
      `select count(*)::int as n from chart_sources s join charts c on c.id = s.chart_id where c.user_id = $1`,
      [me.id],
    );
    expect((kept.rows[0] as { n: number }).n).toBe(2);
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

describe("The sources migration", () => {
  it("makes every chart made before it a chart of the one source it named", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const old = new PGlite();
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { tag: string }[];
    };
    const run = async (tag: string) => {
      for (const part of readFileSync(`drizzle/${tag}.sql`, "utf8").split(
        "--> statement-breakpoint",
      )) {
        if (part.trim()) await old.exec(part);
      }
    };
    const tags = journal.entries.map((e) => e.tag);
    const at = tags.indexOf("0034_chart_sources");
    for (const tag of tags.slice(0, at)) await run(tag);

    // The rows a chart points at are not what this reads, so nothing checks them.
    await old.exec(`set session_replication_role = replica`);
    const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
    await old.query(
      `insert into charts (id, user_id, project_id, property_id, option_id, position) values ($1, $2, $3, $4, $5, 'a0')`,
      ids,
    );
    await run("0034_chart_sources");
    const sources = await old.query(
      `select chart_id, project_id, property_id, option_id, position from chart_sources`,
    );
    expect(sources.rows).toEqual([
      {
        chart_id: ids[0],
        project_id: ids[2],
        property_id: ids[3],
        option_id: ids[4],
        position: "a0",
      },
    ]);
    const charts = await old.query(`select * from charts`);
    expect(charts.rows).toEqual([{ id: ids[0], user_id: ids[1], position: "a0" }]);
    await old.close();
  });
});
