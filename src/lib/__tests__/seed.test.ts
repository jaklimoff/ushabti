import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("@/db/index", async () => ({
  ...(await import("@/test/db")),
  pool: { end: async () => {} },
}));

/*
 * The seed writes the defaults a new project gets, and demo tasks on top.
 * It runs on import, against the in-memory database here.
 */
describe("The seed", () => {
  it("runs, and its project has no Phase for a demo task to carry", async () => {
    await import("@/db/seed");
    const { db } = await import("@/test/db");
    const { properties, tasks, taskValues } = await import("@/db/schema");

    const names = (await db.select({ name: properties.name }).from(properties)).map((p) => p.name);
    expect(names).toContain("Status");
    expect(names).not.toContain("Phase");

    const written = await db.select({ id: tasks.id }).from(tasks);
    expect(written.length).toBeGreaterThan(0);
    // Every value a demo task holds belongs to a property the project has.
    const ids = new Set((await db.select({ id: properties.id }).from(properties)).map((p) => p.id));
    for (const v of await db.select().from(taskValues)) expect(ids.has(v.propertyId)).toBe(true);
    // The seed writes a whole demo project row by row, which takes more than
    // the default five seconds while the rest of the suite runs beside it.
  }, 60_000);
});
