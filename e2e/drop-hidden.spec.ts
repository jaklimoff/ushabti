import { expect, test, type Page } from "@playwright/test";
import {
  card,
  createProject,
  gotoSettings,
  inDatabase,
  propertyBox,
  register,
  settles,
  unique,
} from "./helpers";

type Property = { id: string; name: string; options: { id: string; name: string }[] };
type Board = {
  properties: Property[];
  views: { id: string; isDefault: boolean }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};
type Dropped = { taskId: string; propertyId: string; name: string };
type Detail = { task: { activity: { kind: string; data: Record<string, unknown> }[] } };

/** Any write to a task's values: one task, or the picked ones in one call. */
const WRITE = /\/api\/(tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+|projects\/[0-9a-f-]+\/tasks\/values)$/;

async function board(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/**
 * A project with a Type select of Bug and Story, Priority shown only for a
 * Bug, and two bugs with an Urgent priority. Priority stands in for Severity,
 * because it is on the card of a new project already.
 */
async function bugs(page: Page, name: string, rule = true) {
  await register(page);
  const projectId = await createProject(page, unique(name));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Type", type: "select", options: ["Bug", "Story"] },
  });
  expect(made.ok()).toBeTruthy();
  const read = await board(page, projectId);
  const of = (n: string) => read.properties.find((p) => p.name === n)!;
  const type = of("Type");
  const priority = of("Priority");
  const status = of("Status");
  const bug = type.options.find((o) => o.name === "Bug")!.id;
  const story = type.options.find((o) => o.name === "Story")!.id;
  const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
  const todo = status.options.find((o) => o.name === "Todo")!.id;
  const ids: Record<string, string> = {};
  for (const title of ["First bug", "Second bug"]) {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [status.id]: todo, [type.id]: bug, [priority.id]: urgent } },
    });
    expect(res.ok()).toBeTruthy();
    ids[title] = ((await res.json()) as { task: { id: string } }).task.id;
  }
  if (rule) {
    const res = await page.request.patch(`/api/properties/${priority.id}`, {
      data: { when: { propertyId: type.id, optionIds: [bug] } },
    });
    expect(res.ok()).toBeTruthy();
  }
  const valuesOf = async (title: string) =>
    (await board(page, projectId)).tasks.find((t) => t.title === title)!.values;
  return { projectId, type, priority, status, bug, story, urgent, todo, ids, valuesOf };
}

/**
 * Three rules in a circle, so all three read as none: Area shows for a Bug,
 * Type for a Small task, Size for a Front one. No route writes a circle, so the
 * rules go straight in. A Story in the Back, sized Big, shows all three, and
 * loses its Area the moment Type's rule goes and Area's comes on.
 */
async function circle(page: Page, name: string) {
  await register(page);
  const projectId = await createProject(page, unique(name));
  const selects = { Type: ["Bug", "Story"], Area: ["Front", "Back"], Size: ["Big", "Small"] };
  for (const [n, options] of Object.entries(selects)) {
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: n, type: "select", options },
    });
    expect(made.ok()).toBeTruthy();
  }
  const read = await board(page, projectId);
  const of = (n: string) => read.properties.find((p) => p.name === n)!;
  const opt = (p: Property, n: string) => p.options.find((o) => o.name === n)!.id;
  const [type, area, size] = [of("Type"), of("Area"), of("Size")];
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: {
      title: "A story",
      values: {
        [type.id]: opt(type, "Story"),
        [area.id]: opt(area, "Back"),
        [size.id]: opt(size, "Big"),
      },
    },
  });
  expect(res.ok()).toBeTruthy();
  const rules: [Property, Property, string][] = [
    [area, type, opt(type, "Bug")],
    [type, size, opt(size, "Small")],
    [size, area, opt(area, "Front")],
  ];
  await inDatabase(async (client) => {
    for (const [on, by, optionId] of rules) {
      await client.query(
        `update properties set config = config || jsonb_build_object('when', $2::jsonb) where id = $1`,
        [on.id, JSON.stringify({ propertyId: by.id, optionIds: [optionId] })],
      );
    }
  });
  const valuesOf = async () =>
    (await board(page, projectId)).tasks.find((t) => t.title === "A story")!.values;
  expect(await valuesOf()).toHaveProperty(area.id);
  return { projectId, type, area, size, small: opt(size, "Small"), valuesOf };
}

test.describe("A value its task does not show is dropped", () => {
  test("the value, bulk and move routes drop at once and answer with what went", async ({
    page,
  }) => {
    const { projectId, type, priority, status, story, ids, valuesOf } = await bugs(page, "Drop");
    const first = ids["First bug"];

    const set = await page.request.put(`/api/tasks/${first}/values/${type.id}`, {
      data: { value: story },
    });
    expect(set.ok()).toBeTruthy();
    expect(((await set.json()) as { dropped: Dropped[] }).dropped).toEqual([
      { taskId: first, propertyId: priority.id, name: "Priority" },
    ]);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);

    /* The task says what went, in one line. */
    const detail: Detail = await (await page.request.get(`/api/tasks/${first}`)).json();
    const line = detail.task.activity.find((a) => a.kind === "value" && a.data.dropped);
    expect(line?.data).toMatchObject({
      dropped: ["Priority"],
      propertyIds: [priority.id],
      hidBy: "Story",
    });

    /* A write that hides nothing answers with an empty list. */
    const again = await page.request.put(`/api/tasks/${first}/values/${type.id}`, {
      data: { value: story },
    });
    expect(((await again.json()) as { dropped: Dropped[] }).dropped).toEqual([]);

    /* A write to a property the task does not show is accepted and dropped. */
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    const hidden = await page.request.put(`/api/tasks/${first}/values/${priority.id}`, {
      data: { value: urgent },
    });
    expect(((await hidden.json()) as { dropped: Dropped[] }).dropped).toHaveLength(1);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);

    /* A drag across columns of Type drops in the same call. */
    const second = ids["Second bug"];
    const moved = await page.request.post(`/api/tasks/${second}/move`, {
      data: { values: { [type.id]: story } },
    });
    expect(((await moved.json()) as { dropped: Dropped[] }).dropped).toEqual([
      { taskId: second, propertyId: priority.id, name: "Priority" },
    ]);
    expect(await valuesOf("Second bug")).not.toHaveProperty(priority.id);

    /* A bulk set answers for every task. */
    const bug = type.options.find((o) => o.name === "Bug")!.id;
    for (const id of [first, second]) {
      await page.request.put(`/api/tasks/${id}/values/${type.id}`, { data: { value: bug } });
      await page.request.put(`/api/tasks/${id}/values/${priority.id}`, { data: { value: urgent } });
    }
    const bulk = await page.request.post(`/api/projects/${projectId}/tasks/values`, {
      data: { taskIds: [first, second], propertyId: type.id, value: story },
    });
    const answer = (await bulk.json()) as { set: number; dropped: Dropped[] };
    expect(answer.set).toBe(2);
    expect(answer.dropped.map((d) => d.taskId).sort()).toEqual([first, second].sort());

    /* A bulk set of another property drops nothing. */
    const todo = status.options.find((o) => o.name === "Todo")!.id;
    const plain = await page.request.post(`/api/projects/${projectId}/tasks/values`, {
      data: { taskIds: [first], propertyId: status.id, value: todo },
    });
    expect(((await plain.json()) as { dropped: Dropped[] }).dropped).toEqual([]);
  });

  test("an agent write, an option delete and a ship drop at once", async ({ page }) => {
    const { projectId, type, priority, story, bug, ids, valuesOf } = await bugs(
      page,
      "Drop at once",
    );

    const agent = await page.request.post(`/api/projects/${projectId}/agents`, {
      data: { name: "Helper" },
    });
    const agentId = ((await agent.json()) as { agent: { id: string } }).agent.id;
    const issued = await page.request.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
      data: { name: "drop" },
    });
    const secret = ((await issued.json()) as { secret: string }).secret;
    const asAgent = await page.request.put(`/api/tasks/${ids["First bug"]}/values/${type.id}`, {
      headers: { Authorization: `Bearer ${secret}` },
      data: { value: story },
    });
    expect(((await asAgent.json()) as { dropped: Dropped[] }).dropped).toHaveLength(1);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);

    /* Shown for a Bug or a Story; Story goes, and a task that was a Story is
       left with no type, which does not show Priority. */
    await page.request.patch(`/api/properties/${priority.id}`, {
      data: { when: { propertyId: type.id, optionIds: [bug, story] } },
    });
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    await page.request.put(`/api/tasks/${ids["First bug"]}/values/${priority.id}`, {
      data: { value: urgent },
    });
    expect(await valuesOf("First bug")).toHaveProperty(priority.id, urgent);
    expect((await page.request.delete(`/api/options/${story}`)).ok()).toBeTruthy();
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);
    expect(await valuesOf("Second bug")).toHaveProperty(priority.id, urgent);
    const detail: Detail = await (await page.request.get(`/api/tasks/${ids["First bug"]}`)).json();
    expect(detail.task.activity.filter((a) => a.kind === "value" && a.data.dropped)).toHaveLength(
      2,
    );

    /* A ship that clears a dated Type leaves the task with no type. */
    expect(
      (await page.request.patch(`/api/properties/${type.id}`, { data: { dated: true } })).ok(),
    ).toBeTruthy();
    expect(
      (await page.request.patch(`/api/options/${bug}`, { data: { targetAt: "2026-10-14" } })).ok(),
    ).toBeTruthy();
    const shipped = await page.request.post(`/api/options/${bug}/ship`, {
      data: { rest: "clear" },
    });
    expect(shipped.ok()).toBeTruthy();
    expect(await valuesOf("Second bug")).not.toHaveProperty(priority.id);
  });

  test("the panel asks with the names; Cancel writes nothing and Yes drops", async ({ page }) => {
    const { projectId, priority, valuesOf } = await bugs(page, "Drop panel");
    await page.goto(`/p/${projectId}`);
    await card(page, "First bug").click();
    const panel = page.getByTestId("task-panel");
    const typeRow = panel.locator('[data-property="Type"]');
    await expect(panel.locator('[data-property="Priority"]')).toBeVisible();

    let wrote = 0;
    page.on("request", (r) => {
      if (WRITE.test(new URL(r.url()).pathname)) wrote += 1;
    });
    await typeRow.getByRole("button", { name: "Story" }).click();
    const ask = panel.getByTestId("value-confirm");
    await expect(ask).toContainText("Change Type to Story? Priority loses its value.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    expect(wrote).toBe(0);
    await expect(panel.locator('[data-property="Priority"]')).toBeVisible();

    await typeRow.getByRole("button", { name: "Story" }).click();
    await settles(page, WRITE, () => ask.getByRole("button", { name: "Yes, change" }).click());
    await expect(panel.locator('[data-property="Priority"]')).toHaveCount(0);
    await expect(
      card(page, "First bug").locator('[data-testid="card-chip"][title="Priority · Urgent"]'),
    ).toHaveCount(0);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);
    /* The panel reads its history when it opens. */
    await page.reload();
    await card(page, "First bug").click();
    await panel.getByRole("tab", { name: "Activity" }).click();
    await expect(panel.getByText("Story hid Priority, and its value was dropped")).toBeVisible();

    /* Back to Bug hides nothing, so it asks nothing. */
    await settles(page, WRITE, () => typeRow.getByRole("button", { name: "Bug" }).click());
    await expect(ask).toHaveCount(0);
  });

  test("bulk Set asks first with the counts", async ({ page }) => {
    const { projectId, priority, valuesOf } = await bugs(page, "Drop bulk");
    await page.goto(`/p/${projectId}`);
    for (const title of ["First bug", "Second bug"]) {
      await card(page, title).getByTestId("card-pick").click();
    }
    await page.getByTestId("pick-set").click();
    const search = page.getByTestId("pick-search");
    await search.fill("Type");
    await search.press("Enter");
    await page.getByTestId("pick-menu").getByRole("button", { name: "Story" }).click();

    await expect(page.getByTestId("pick-set-confirm")).toHaveText(
      "Set Type to Story on 2 tasks? 2 values go (Priority).",
    );
    await page.getByTestId("pick-set-no").click();
    expect(await valuesOf("First bug")).toHaveProperty(priority.id);

    await page.getByTestId("pick-set").click();
    await search.fill("Type");
    await search.press("Enter");
    await page.getByTestId("pick-menu").getByRole("button", { name: "Story" }).click();
    await settles(page, WRITE, () => page.getByTestId("pick-set-yes").click());
    await expect(
      card(page, "Second bug").locator('[data-testid="card-chip"][title="Priority · Urgent"]'),
    ).toHaveCount(0);
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);
    expect(await valuesOf("Second bug")).not.toHaveProperty(priority.id);
  });

  test("the bulk question goes when the picks change under it", async ({ page }) => {
    const { projectId, priority, valuesOf } = await bugs(page, "Drop repick");
    await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title: "Third" } });
    await page.goto(`/p/${projectId}`);
    for (const title of ["First bug", "Second bug"]) {
      await card(page, title).getByTestId("card-pick").click();
    }
    await page.getByTestId("pick-set").click();
    const search = page.getByTestId("pick-search");
    await search.fill("Type");
    await search.press("Enter");
    await page.getByTestId("pick-menu").getByRole("button", { name: "Story" }).click();
    await expect(page.getByTestId("pick-set-confirm")).toContainText("on 2 tasks?");

    /* Yes would set the picks of the click, which the question did not count. */
    await card(page, "Third").getByTestId("card-pick").click();
    await expect(page.getByTestId("pick-set-confirm")).toHaveCount(0);
    await expect(page.getByTestId("pick-count")).toHaveText("3 selected");
    expect(await valuesOf("First bug")).toHaveProperty(priority.id);
  });

  test("a rule written beside a create leaves the new task no hidden value", async ({ page }) => {
    const { projectId, type, priority, bug, story, urgent } = await bugs(
      page,
      "Drop beside",
      false,
    );
    for (let round = 0; round < 3; round++) {
      await page.request.patch(`/api/properties/${priority.id}`, { data: { when: null } });
      const [rule, ...made] = await Promise.all([
        page.request.patch(`/api/properties/${priority.id}`, {
          data: { when: { propertyId: type.id, optionIds: [bug] } },
        }),
        ...[0, 1, 2, 3].map((n) =>
          page.request.post(`/api/projects/${projectId}/tasks`, {
            data: {
              title: `Story ${round}.${n}`,
              values: { [type.id]: story, [priority.id]: urgent },
            },
          }),
        ),
      ]);
      expect(rule.ok()).toBeTruthy();
      for (const answer of made) expect(answer.status()).toBe(201);
      const stories = (await board(page, projectId)).tasks.filter((t) =>
        t.title.startsWith(`Story ${round}.`),
      );
      expect(stories).toHaveLength(4);
      for (const t of stories) expect(t.values).not.toHaveProperty(priority.id);
    }
  });

  test("a clear that breaks a circle is counted before it drops", async ({ page }) => {
    const { type, area, valuesOf } = await circle(page, "Drop circle count");
    const count = await page.request.get(
      `/api/properties/${type.id}/count?when=${encodeURIComponent("null")}`,
    );
    expect(await count.json()).toEqual({ tasks: 1, names: ["Area", "Size"] });
    expect(await valuesOf()).toHaveProperty(area.id);
  });

  test("an option delete that breaks a circle drops what the rule it frees hides", async ({
    page,
  }) => {
    const { area, small, valuesOf } = await circle(page, "Drop circle option");
    expect((await page.request.delete(`/api/options/${small}`)).ok()).toBeTruthy();
    expect(await valuesOf()).not.toHaveProperty(area.id);
  });

  test("a property delete that breaks a circle drops what the rule it frees hides", async ({
    page,
  }) => {
    const { area, size, valuesOf } = await circle(page, "Drop circle property");
    expect((await page.request.delete(`/api/properties/${size.id}`)).ok()).toBeTruthy();
    expect(await valuesOf()).not.toHaveProperty(area.id);
  });

  test("a rule that breaks a circle in Settings shows the rules it frees at once", async ({
    page,
  }) => {
    const { projectId, size, area, valuesOf } = await circle(page, "Drop circle screen");
    await gotoSettings(page, projectId);
    /* Every rule of the circle reads as none, here as on the board. */
    for (const name of ["Type", "Area", "Size"]) {
      await expect(propertyBox(page, name).getByTestId("when-said")).toHaveCount(0);
    }

    /* Size shown when Priority is Urgent breaks the circle, and frees the
       rules of Type and Area; the story has no priority, so all three go. */
    const box = propertyBox(page, "Size");
    await box.getByRole("button", { name: "Shown when…" }).click();
    await box.getByLabel("Shown when of Size").selectOption({ label: "Priority" });
    await box.getByLabel("Urgent", { exact: true }).click();
    const read = page.waitForResponse(
      (r) => r.url().endsWith(`/api/projects/${projectId}/board`) && r.request().method() === "GET",
    );
    await settles(page, /\/api\/properties\/[0-9a-f-]+$/, () =>
      box.getByTestId("when-confirm").getByRole("button", { name: "Yes, hide" }).click(),
    );
    await read;
    await expect(propertyBox(page, "Size").getByTestId("when-said")).toHaveText(
      "Shown when Priority is Urgent",
    );
    await expect(propertyBox(page, "Type").getByTestId("when-said")).toHaveText(
      "Shown when Size is Small",
    );
    await expect(propertyBox(page, "Area").getByTestId("when-said")).toHaveText(
      "Shown when Type is Bug",
    );
    const values = await valuesOf();
    expect(values).not.toHaveProperty(area.id);
    expect(values).not.toHaveProperty(size.id);
  });

  test("a rule written in Settings asks with the count, then drops", async ({ page }) => {
    const { projectId, priority, story, ids, type, valuesOf } = await bugs(
      page,
      "Drop rule",
      false,
    );
    await page.request.put(`/api/tasks/${ids["First bug"]}/values/${type.id}`, {
      data: { value: story },
    });

    await gotoSettings(page, projectId);
    const box = propertyBox(page, "Priority");
    await box.getByRole("button", { name: "Shown when…" }).click();
    await box.getByLabel("Shown when of Priority").selectOption({ label: "Type" });
    await box.getByLabel("Bug", { exact: true }).click();
    const ask = box.getByTestId("when-confirm");
    await expect(ask).toContainText("1 task loses its Priority.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(await valuesOf("First bug")).toHaveProperty(priority.id);

    await box.getByLabel("Bug", { exact: true }).click();
    await settles(page, /\/api\/properties\/[0-9a-f-]+$/, () =>
      ask.getByRole("button", { name: "Yes, hide" }).click(),
    );
    await expect(box.getByTestId("when-said")).toHaveText("Shown when Type is Bug");
    expect(await valuesOf("First bug")).not.toHaveProperty(priority.id);
    expect(await valuesOf("Second bug")).toHaveProperty(priority.id);
  });

  test("writes to one task at once all land, and none leaves a hidden value", async ({ page }) => {
    const { type, priority, bug, story, urgent, ids, valuesOf } = await bugs(page, "Drop race");
    const id = ids["First bug"];
    /* A type and a hidden field at the same moment used to deadlock: each
       held a value row the other's drop deleted. */
    for (let round = 0; round < 3; round++) {
      const answers = await Promise.all(
        [bug, story, bug, story].flatMap((kind) => [
          page.request.put(`/api/tasks/${id}/values/${type.id}`, { data: { value: kind } }),
          page.request.put(`/api/tasks/${id}/values/${priority.id}`, { data: { value: urgent } }),
        ]),
      );
      for (const answer of answers) expect(answer.status()).toBe(200);
      const values = await valuesOf("First bug");
      expect(values[type.id] === bug || !(priority.id in values)).toBe(true);
    }

    /* A task deleted while a rule was written comes back without the value
       the rule hides. */
    const second = ids["Second bug"];
    await page.request.put(`/api/tasks/${second}/values/${type.id}`, { data: { value: bug } });
    await page.request.put(`/api/tasks/${second}/values/${priority.id}`, {
      data: { value: urgent },
    });
    expect((await page.request.delete(`/api/tasks/${second}`)).ok()).toBeTruthy();
    expect(
      (
        await page.request.patch(`/api/properties/${priority.id}`, {
          data: { when: { propertyId: type.id, optionIds: [story] } },
        })
      ).ok(),
    ).toBeTruthy();
    expect((await page.request.post(`/api/tasks/${second}/restore`)).ok()).toBeTruthy();
    expect(await valuesOf("Second bug")).not.toHaveProperty(priority.id);
  });
});
