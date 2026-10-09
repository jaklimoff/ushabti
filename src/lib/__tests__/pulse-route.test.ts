import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { activity, projects } = await import("@/db/schema");
const { board, person, project } = await import("@/test/route");
const { listProjectsWithPulse } = await import("@/lib/queries");
const { dayBefore } = await import("@/lib/charts");

/*
 * The fourteen bars of a project card: the feed counted by the day in the
 * project's zone, for every project on Home at once.
 */

const line = (projectId: string, at: string) => ({
  projectId,
  kind: "comment",
  data: {},
  createdAt: new Date(at),
});

describe("A project's fourteen days", () => {
  it("cuts the days in the project's zone, and drops what falls before the first bar", async () => {
    const me = await person("Pulse Reader");
    const p = await project(me);
    await db.update(projects).set({ timeZone: "Asia/Tokyo" }).where(eq(projects.id, p.id));
    const today = (await board(me, p.id)).today as string;
    const three = dayBefore(today, 3);
    await db.insert(activity).values([
      // 23:00 in Tokyo, so three days ago there.
      line(p.id, `${three}T14:00:00Z`),
      // 05:00 the next morning in Tokyo, though still that day in UTC.
      line(p.id, `${three}T20:00:00Z`),
      line(p.id, `${three}T21:00:00Z`),
      // Noon in Tokyo fourteen days ago, one day before the first bar.
      line(p.id, `${dayBefore(today, 14)}T03:00:00Z`),
    ]);

    const [row] = await listProjectsWithPulse(me.id);
    const days = row.pulse.days;
    expect(days).toHaveLength(14);
    // Making the project wrote its own lines today; only the past is fixed here.
    expect(days.slice(0, -1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0]);
  });

  it("asks one query for every project on Home", async () => {
    const me = await person("Pulse Counter");
    const a = await project(me);
    const b = await project(me);
    await db
      .insert(activity)
      .values([
        line(a.id, new Date().toISOString()),
        line(b.id, new Date().toISOString()),
        line(b.id, new Date().toISOString()),
      ]);
    const query = vi.spyOn(PGlite.prototype, "query");
    const rows = await listProjectsWithPulse(me.id);
    const asked = query.mock.calls.filter(([sql]) => String(sql).includes("to_char("));
    query.mockRestore();

    expect(asked).toHaveLength(1);
    const today = (id: string) => rows.find((r) => r.id === id)!.pulse.days.at(-1)!;
    expect(today(b.id) - today(a.id)).toBe(1);
  });
});
