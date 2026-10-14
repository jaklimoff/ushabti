import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createProject, gotoSettings, inDatabase, propertyBox, register, unique } from "./helpers";

/**
 * The two migrations that sprints and releases brought, run again on the
 * real database. The switches themselves are `sprint-route.test.ts` and
 * `Sprints.test.tsx` of the settings.
 */

type Board = {
  project: { releaseBy: string | null; sprintBy: string | null };
  properties: {
    id: string;
    name: string;
    type: string;
    config: { dated?: boolean };
    options: unknown[];
  }[];
  views: {
    id: string;
    name: string;
    kind: string;
    groupById: string | null;
    isDefault: boolean;
    filters: { rules: { propertyId: string; op: string; values?: string[] }[] };
  }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board;
}

/*
 * The migration that made an old Sprint an iteration. It runs once on a real
 * database, so the test runs its own SQL again over rows made the old way:
 * the dated Sprint turns, and a Sprint with no dates and a dated Version stay.
 */
test("the migration turns a dated Sprint select into an iteration and nothing else", async ({
  page,
}) => {
  await register(page, "Olga Owner");
  const projectId = await createProject(page, unique("Old sprints"));
  const otherId = await createProject(page, unique("Plain sprints"));
  const make = async (name: string, dated: boolean, project = projectId) => {
    const res = await page.request.post(`/api/projects/${project}/properties`, {
      data: { name, type: "select" },
    });
    const id = ((await res.json()) as { property: { id: string } }).property.id;
    /* Off is what a new select already is, so the write changes nothing then. */
    const said = await page.request.patch(`/api/properties/${id}`, { data: { dated } });
    expect(said.ok()).toBe(true);
    return id;
  };
  const sprint = await make("Sprint", true);
  const version = await make("Version", true);
  const plain = await make("Sprint", false, otherId);

  const sql = readFileSync("drizzle/0022_sprint_iteration.sql", "utf8");
  await inDatabase((db) => db.query(sql));

  const types = await inDatabase(async (db) => {
    const { rows } = await db.query<{ id: string; type: string }>(
      "SELECT id, type FROM properties WHERE project_id = ANY($1)",
      [[projectId, otherId]],
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.type]));
  });
  expect(types[sprint]).toBe("iteration");
  expect(types[version]).toBe("select");
  expect(types[plain]).toBe("select");
});

/*
 * The migration that gave the switches their pointers. It runs once on a real
 * database, so the test runs its own SQL again over rows made the old way, in
 * a transaction it rolls back so no other project moves, and writes what it
 * read for this project alone. Two dated selects keep everything they had.
 */
test("the migration points at the first dated select and the first iteration", async ({ page }) => {
  await register(page, "Olga Owner");
  const projectId = await createProject(page, unique("Old releases"));
  const make = async (name: string, type: string) => {
    const res = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name, type, options: ["One", "Two"] },
    });
    return ((await res.json()) as { property: { id: string } }).property.id;
  };
  await make("Plain", "select");
  const version = await make("Version", "select");
  const epic = await make("Epic", "select");
  const cycle = await make("Cycle", "iteration");
  /* Dated the old way, through the flag the Properties page used to switch. */
  for (const id of [version, epic]) {
    const said = await page.request.patch(`/api/properties/${id}`, { data: { dated: true } });
    expect(said.ok()).toBe(true);
  }

  const statements = readFileSync("drizzle/0028_release_sprint_by.sql", "utf8")
    .split("--> statement-breakpoint")
    .filter((s) => s.includes("UPDATE"));
  const pointers = await inDatabase(async (db) => {
    await db.query("BEGIN");
    try {
      for (const sql of statements) await db.query(sql);
      const { rows } = await db.query<{ release_by: string; sprint_by: string }>(
        "SELECT release_by, sprint_by FROM projects WHERE id = $1",
        [projectId],
      );
      return rows[0];
    } finally {
      await db.query("ROLLBACK");
    }
  });
  expect(pointers).toEqual({ release_by: version, sprint_by: cycle });
  await inDatabase((db) =>
    db.query("UPDATE projects SET release_by = $2, sprint_by = $3 WHERE id = $1", [
      projectId,
      pointers.release_by,
      pointers.sprint_by,
    ]),
  );

  const read = await board(page, projectId);
  expect(read.project).toMatchObject({ releaseBy: version, sprintBy: cycle });

  /* Both dated selects keep their date boxes in Settings. */
  await gotoSettings(page, projectId);
  for (const name of ["Version", "Epic"]) {
    await expect(propertyBox(page, name).getByLabel("Start of One")).toBeVisible();
  }
  await expect(propertyBox(page, "Plain").getByLabel("Start of One")).toHaveCount(0);
  await expect(page.getByText("Options carry dates")).toHaveCount(0);

  /* Both draw a roadmap, and both ship. */
  for (const id of [version, epic]) {
    const view = await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: `Plan ${id.slice(0, 4)}`, kind: "roadmap", groupById: id },
    });
    expect(view.ok()).toBe(true);
    const property = read.properties.find((p) => p.id === id)!;
    const one = (property.options as { id: string }[])[0];
    expect(
      (
        await page.request.patch(`/api/options/${one.id}`, {
          data: { startAt: "2026-10-01", targetAt: "2026-10-14" },
        })
      ).ok(),
    ).toBe(true);
    const ship = await page.request.post(`/api/options/${one.id}/ship`, {
      data: { rest: "leave" },
    });
    expect(ship.ok()).toBe(true);
  }
  const roadmaps = (await board(page, projectId)).views.filter((v) => v.kind === "roadmap");
  expect(roadmaps.map((v) => v.groupById).sort()).toEqual([version, epic].sort());
});
