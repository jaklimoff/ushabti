import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createProject, gotoSettings, inDatabase, propertyBox, register, unique } from "./helpers";

/**
 * Releases and sprints are two switches in Settings → Project.
 *
 * The unit tests hold the shape of the filters and the words of the off
 * question. What they cannot reach is the road: each switch says what it
 * makes, one press makes all of it in one go, off asks in place and keeps
 * everything, and on again takes what is there. The door is shut to a member
 * and an agent.
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

test("an admin turns sprints on in one press; a member and an agent are refused", async ({
  page,
  browser,
}) => {
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await register(memberPage, "Bob Member");

  await register(page, "Olga Owner");
  const projectId = await createProject(page, unique("Sprints"));
  const as = page.request;
  expect(
    (await as.post(`/api/projects/${projectId}/members`, { data: { email: member.email } })).ok(),
  ).toBeTruthy();

  /* ---- the door is shut to a member and to an agent ----------------- */

  const url = `/api/projects/${projectId}/sprints`;
  expect((await memberPage.request.post(url)).status()).toBe(403);
  expect((await memberPage.request.delete(url)).status()).toBe(403);
  const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Helper" } });
  const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
  const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
    data: { name: "sprints" },
  });
  const secret = ((await issued.json()) as { secret: string }).secret;
  const headers = { Authorization: `Bearer ${secret}` };
  expect((await memberPage.request.post(url, { headers })).status()).toBe(403);
  expect((await memberPage.request.delete(url, { headers })).status()).toBe(403);
  expect((await board(page, projectId)).properties.map((p) => p.name)).not.toContain("Sprint");

  /* ---- a member is not offered the switch ---------------------------- */

  await gotoSettings(memberPage, projectId, "project");
  await expect(memberPage.getByLabel("Project name")).toBeVisible();
  await expect(memberPage.getByRole("switch", { name: "Use sprints" })).toHaveCount(0);
  await expect(memberPage.getByRole("switch", { name: "Use releases" })).toHaveCount(0);

  /* ---- the switch says what it makes, then makes it ------------------ */

  const before = await board(page, projectId);
  const main = before.views.find((v) => v.isDefault)!;

  await gotoSettings(page, projectId, "project");
  const toggle = page.getByRole("switch", { name: "Use sprints" });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/a sprint property Sprint with Sprint 1/)).toBeVisible();
  await expect(page.getByText(/a list Backlog of the tasks in no sprint/)).toBeVisible();

  const answer = page.waitForResponse((res) => res.url().endsWith("/sprints"));
  await toggle.click();
  expect((await answer).status()).toBe(201);
  await expect(toggle).toBeChecked();
  await expect(page.getByText(/Sprints are the options of Sprint/)).toBeVisible();

  const after = await board(page, projectId);
  const sprint = after.properties.find((p) => p.name === "Sprint")!;
  /* A sprint is an iteration, whose options always carry dates. */
  expect(sprint).toMatchObject({ type: "iteration" });
  expect(after.project.sprintBy).toBe(sprint.id);
  /* On makes the first sprint and the one after it. */
  expect(sprint.options).toHaveLength(2);
  const added = after.views.filter((v) => !before.views.some((b) => b.id === v.id));
  expect(added.map((v) => [v.name, v.kind])).toEqual([
    ["Sprint", "board"],
    ["Backlog", "list"],
  ]);
  const [sprintBoard, backlog] = added;
  expect(sprintBoard.groupById).toBe(main.groupById);
  expect(sprintBoard.filters.rules).toEqual([
    { propertyId: sprint.id, op: "is", values: ["__current__"] },
  ]);
  expect(backlog.filters.rules).toEqual([
    { propertyId: sprint.id, op: "is", values: ["__none__"] },
  ]);
  expect(added.every((v) => !v.isDefault)).toBe(true);

  /* ---- on while on makes nothing twice ------------------------------- */

  expect((await as.post(url)).status()).toBe(200);
  const again = await board(page, projectId);
  expect(again.properties.filter((p) => p.type === "iteration")).toHaveLength(1);
  expect(again.views).toHaveLength(after.views.length);

  /* ---- off asks in place, in real numbers, and keeps everything ------ */

  const optionId = (sprint.options[0] as { id: string }).id;
  const task = await as.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Alpha", values: { [sprint.id]: optionId } },
  });
  expect(task.ok()).toBeTruthy();
  await page.reload();
  await toggle.click();
  const question = page.getByRole("alertdialog");
  await expect(question).toContainText(
    "Turn sprints off? Nothing is deleted: Sprint keeps its 2 sprints, 1 task keeps its sprint, and 2 views stay.",
  );
  /* Cancel leaves it on. */
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  const off = page.waitForResponse((res) => res.url().endsWith("/sprints"));
  await page.getByRole("button", { name: "Yes, turn off" }).click();
  expect((await off).status()).toBe(200);
  await expect(toggle).not.toBeChecked();

  const kept = await board(page, projectId);
  expect(kept.project.sprintBy).toBeNull();
  expect(kept.properties.find((p) => p.id === sprint.id)?.options).toHaveLength(2);
  expect(kept.views.map((v) => v.id).sort()).toEqual(after.views.map((v) => v.id).sort());
  const held = (await (await as.get(`/api/projects/${projectId}/board`)).json()) as {
    tasks: { title: string; values: Record<string, unknown> }[];
  };
  expect(held.tasks.find((t) => t.title === "Alpha")?.values[sprint.id]).toBe(optionId);

  /* ---- on again takes what is there ---------------------------------- */

  const on = page.waitForResponse((res) => res.url().endsWith("/sprints"));
  await toggle.click();
  expect((await on).status()).toBe(200);
  await expect(toggle).toBeChecked();
  const back = await board(page, projectId);
  expect(back.project.sprintBy).toBe(sprint.id);
  expect(back.properties.filter((p) => p.type === "iteration")).toHaveLength(1);
  expect(back.views).toHaveLength(after.views.length);

  /* ---- what it made is ordinary, and a name is not the switch -------- */

  expect(
    (await as.patch(`/api/properties/${sprint.id}`, { data: { name: "Cycle" } })).ok(),
  ).toBeTruthy();
  expect((await board(page, projectId)).project.sprintBy).toBe(sprint.id);
  expect((await as.delete(`/api/properties/${sprint.id}`)).ok()).toBeTruthy();
  /* A plain select named Sprint is just a select. */
  expect(
    (
      await as.post(`/api/projects/${projectId}/properties`, {
        data: { name: "Sprint", type: "select" },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await board(page, projectId)).project.sprintBy).toBeNull();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByLabel("Sprint length in days")).toBeVisible();

  await memberContext.close();
});

test("an admin turns releases on: a dated Release with no options and a Roadmap on it", async ({
  page,
}) => {
  await register(page, "Olga Owner");
  const projectId = await createProject(page, unique("Releases"));
  const before = await board(page, projectId);

  await gotoSettings(page, projectId, "project");
  const toggle = page.getByRole("switch", { name: "Use releases" });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/Adds a property Release with no releases yet/)).toBeVisible();

  const answer = page.waitForResponse((res) => res.url().endsWith("/releases"));
  await toggle.click();
  expect((await answer).status()).toBe(201);
  await expect(toggle).toBeChecked();

  const after = await board(page, projectId);
  const release = after.properties.find((p) => p.name === "Release")!;
  expect(release).toMatchObject({ type: "select", config: { dated: true }, options: [] });
  expect(after.project.releaseBy).toBe(release.id);
  const added = after.views.filter((v) => !before.views.some((b) => b.id === v.id));
  expect(added.map((v) => [v.name, v.kind, v.groupById, v.isDefault])).toEqual([
    ["Roadmap", "roadmap", release.id, false],
  ]);

  /* Off asks, says what stays, and keeps it. */
  await toggle.click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Turn releases off? Nothing is deleted: Release keeps its 0 releases, no task holds a release, and 1 view stays.",
  );
  const off = page.waitForResponse((res) => res.url().endsWith("/releases"));
  await page.getByRole("button", { name: "Yes, turn off" }).click();
  expect((await off).status()).toBe(200);
  await expect(toggle).not.toBeChecked();
  const kept = await board(page, projectId);
  expect(kept.project.releaseBy).toBeNull();
  expect(kept.properties.map((p) => p.id)).toContain(release.id);
  expect(kept.views).toHaveLength(after.views.length);

  /* On again makes no second Release and no second Roadmap. */
  const on = page.waitForResponse((res) => res.url().endsWith("/releases"));
  await toggle.click();
  expect((await on).status()).toBe(200);
  await expect(toggle).toBeChecked();
  const back = await board(page, projectId);
  expect(back.project.releaseBy).toBe(release.id);
  expect(back.properties.filter((p) => p.name === "Release")).toHaveLength(1);
  expect(back.views).toHaveLength(after.views.length);

  /* The property page draws the dates, with no switch to learn. */
  await gotoSettings(page, projectId);
  await expect(page.getByText("Options carry dates")).toHaveCount(0);
});

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
