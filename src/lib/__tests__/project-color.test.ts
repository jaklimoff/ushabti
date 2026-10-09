import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db, pool } = await import("@/db");
const { projects } = await import("@/db/schema");
const { PROJECT_COLORS, PROJECT_INK, pickProjectColor } = await import("@/lib/colors");
const { agent, api, join, ok, person, project } = await import("@/test/route");

/*
 * A project's colour: picked from its key when it is made, given to the
 * projects already there by migration 0032, and changed only by the owner or
 * an admin.
 */

type Listed = { id: string; key: string; color: string };

async function listed(who: Awaited<ReturnType<typeof person>>) {
  const { projects: list } = await ok<{ projects: Listed[] }>(api(who).get("/api/projects"));
  return list;
}

describe("A project's colour", () => {
  it("is picked from the key when the project is made, and listProjects returns it", async () => {
    const me = await person("Colour Maker");
    const made = await project(me, "Colour Board");
    const [row] = await listed(me);
    expect(row.id).toBe(made.id);
    expect(row.color).toBe(pickProjectColor(made.key));
    expect(PROJECT_COLORS).toContain(row.color);
  });

  it("differs for keys made one after another", () => {
    const keys = ["USH", "USI", "USJ", "USK", "USL"];
    expect(new Set(keys.map(pickProjectColor)).size).toBe(keys.length);
  });

  it("is changed by an admin, and refused off the palette", async () => {
    const owner = await person("Colour Owner");
    const admin = await person("Colour Admin");
    const p = await project(owner);
    await join(p.id, admin, "admin");

    await ok(api(admin).patch(`/api/projects/${p.id}`, { color: "#ec8fb8" }));
    expect((await listed(owner)).find((r) => r.id === p.id)?.color).toBe("#ec8fb8");

    const odd = await api(admin).patch(`/api/projects/${p.id}`, { color: "#123456" });
    expect(odd.status).toBe(400);
  });

  it("is refused to a member and to an agent with 403", async () => {
    const owner = await person("Colour Owner Two");
    const member = await person("Colour Member");
    const p = await project(owner);
    await join(p.id, member, "member");
    const bot = await agent(owner, p.id);

    const byMember = await api(member).patch(`/api/projects/${p.id}`, { color: "#ec8fb8" });
    expect(byMember.status).toBe(403);
    const byAgent = await bot.api.patch(`/api/projects/${p.id}`, { color: "#ec8fb8" });
    expect(byAgent.status).toBe(403);

    const [row] = await db.select().from(projects).where(eq(projects.id, p.id));
    expect(row.color).toBe(pickProjectColor(p.key));
  });
});

describe("Migration 0032", () => {
  /* The statement that colours the projects already there, run again over
     rows whose colour is wrong. It has to land on the same pick as a new
     project with that key, including a key outside A to Z. */
  it("gives every existing project the colour its key picks", async () => {
    const owner = await person("Migrated Owner");
    for (const key of ["A", "USH", "USI", "TSK9", "ÄÖÜ", "ZZZZZZ"]) {
      const p = await project(owner);
      await db.update(projects).set({ key, color: "wrong" }).where(eq(projects.id, p.id));
    }
    const sql = readFileSync("drizzle/0032_project_color.sql", "utf8");
    const fill = sql.split("--> statement-breakpoint").find((s) => s.includes("UPDATE"));
    await pool.query(fill!);

    const rows = await db.select({ key: projects.key, color: projects.color }).from(projects);
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row.color).toBe(pickProjectColor(row.key));
  });

  it("copies the palette exactly", () => {
    const sql = readFileSync("drizzle/0032_project_color.sql", "utf8");
    const palette = sql.slice(sql.indexOf("ARRAY["), sql.indexOf("])"));
    expect(palette.match(/#[0-9a-f]{6}/g)).toEqual([...PROJECT_COLORS]);
  });
});

/* WCAG 2's ratio: the key on its swatch is small text, so it needs 4.5. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("Each project colour", () => {
  it.each([...PROJECT_COLORS])("keeps the key readable at WCAG AA on %s", (color) => {
    const [hi, lo] = [luminance(color), luminance(PROJECT_INK)].sort((a, b) => b - a);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
