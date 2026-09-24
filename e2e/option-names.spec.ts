import { expect, test } from "@playwright/test";
import { addTask, createProject, inDatabase, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

async function statusOf(page: Page, projectId: string) {
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  return board.properties.find((p) => p.name === "Status")!;
}

/*
 * The menu guards one tab. Only the server guards everybody: a double Enter,
 * a second person, an agent. So a name is one name in any letter case.
 */
test.describe("One name, one option", () => {
  test("a second option or a rename to a name that is taken answers 409", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Names"));
    const status = await statusOf(page, projectId);
    const options = `/api/properties/${status.id}/options`;

    expect((await page.request.post(options, { data: { name: "Blocked" } })).status()).toBe(201);

    const again = await page.request.post(options, { data: { name: "  blocked " } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toBe("Status already has an option named Blocked.");

    const todo = status.options.find((o) => o.name === "Todo")!;
    const renamed = await page.request.patch(`/api/options/${todo.id}`, {
      data: { name: "BLOCKED" },
    });
    expect(renamed.status()).toBe(409);
    expect((await renamed.json()).error).toBe("Status already has an option named Blocked.");

    /* An option may change the case of its own name. */
    const blocked = (await statusOf(page, projectId)).options.find((o) => o.name === "Blocked")!;
    const own = await page.request.patch(`/api/options/${blocked.id}`, {
      data: { name: "blocked" },
    });
    expect(own.status()).toBe(200);

    const names = (await statusOf(page, projectId)).options.map((o) => o.name.toLowerCase());
    expect(names.filter((n) => n === "blocked")).toHaveLength(1);
    expect(names).toContain("todo");
  });

  test("a new property refuses two options with one name, and makes nothing", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("New names"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Stage", type: "select", options: ["Draft", "Live", " draft "] },
    });
    expect(made.status()).toBe(400);
    expect((await made.json()).error).toBe("Stage already has an option named Draft.");

    const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(board.properties.map((p) => p.name)).not.toContain("Stage");
  });

  test("two creates at once make one option", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Race"));
    const status = await statusOf(page, projectId);

    const answers = await Promise.all(
      ["Waiting", "waiting", "Waiting", "WAITING"].map((name) =>
        page.request.post(`/api/properties/${status.id}/options`, { data: { name } }),
      ),
    );
    const codes = answers.map((a) => a.status()).sort();
    expect(codes).toEqual([201, 409, 409, 409]);

    const after = await statusOf(page, projectId);
    expect(after.options.filter((o) => o.name.toLowerCase() === "waiting")).toHaveLength(1);
  });

  test("the menu says why when the name was taken somewhere else", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Menu names"));
    await addTask(page, "Todo", "Write the notes");
    const status = await statusOf(page, projectId);

    const field = page.getByTestId("task-panel").locator('[data-property="Status"]');
    await field.getByRole("button", { name: "Todo" }).click();
    const box = field.getByLabel("Find or add status");
    await box.fill("Parked");
    await expect(field.getByRole("option", { name: "Add “Parked”" })).toBeVisible();

    /* Somebody else made it a moment ago, and this tab has not heard yet. */
    await inDatabase((db) =>
      db.query(
        "insert into property_options (property_id, name, color, position) values ($1, $2, $3, $4)",
        [status.id, "parked", "#3fb0c8", "zzzz"],
      ),
    );
    await box.press("Enter");
    await expect(page.getByTestId("toast")).toContainText(
      "Status already has an option named parked.",
    );
  });
});
