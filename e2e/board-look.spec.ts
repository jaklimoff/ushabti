import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  addListView,
  backdateRun,
  card,
  column,
  createProject,
  listRow,
  register,
  unique,
} from "./helpers";

type Board = {
  members: { id: string; name: string }[];
  properties: { id: string; name: string; type: string; options: { id: string; name: string }[] }[];
  tasks: { id: string; title: string }[];
};

/** A project, read back, with a way to make a task by the composer's route. */
async function project(page: Page, name = "Look Person") {
  await register(page, name);
  const projectId = await createProject(page, unique("Look"));
  const read = async (): Promise<Board> =>
    (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const board = await read();
  const status = board.properties.find((p) => p.name === "Status")!;
  const option = (name: string) => status.options.find((o) => o.name === name)!.id;
  const task = async (title: string, values: Record<string, unknown> = {}) => {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [status.id]: option("Todo"), ...values } },
    });
    expect(res.status()).toBe(201);
  };
  return { projectId, read, board, option, task };
}

async function connectAgent(page: Page, projectId: string, name: string): Promise<string> {
  const made = await page.request.post(`/api/projects/${projectId}/agents`, { data: { name } });
  const { agent } = (await made.json()) as { agent: { id: string } };
  const minted = await page.request.post(`/api/projects/${projectId}/agents/${agent.id}/tokens`, {
    data: {},
  });
  return ((await minted.json()) as { secret: string }).secret;
}

function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (url: string) => request.get(url, { headers }),
    post: (url: string, data: unknown = {}) => request.post(url, { headers, data }),
    patch: (url: string, data: unknown = {}) => request.patch(url, { headers, data }),
  };
}

test.describe("The board reads cleanly", () => {
  test("a long column name shows in full, and its buttons wait for hover or focus", async ({
    page,
  }, testInfo) => {
    const { option } = await project(page);
    const long = "Waiting on the design review";
    const renamed = await page.request.patch(`/api/options/${option("Todo")}`, {
      data: { name: long },
    });
    expect(renamed.ok()).toBeTruthy();
    await page.reload();

    const head = column(page, long);
    const name = head.getByTestId("column-name");
    await expect(name).toHaveText(long);
    /* Nothing is cut: the words fit the box they are drawn in. */
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await page.mouse.move(0, 0);
    const add = head.getByRole("button", { name: `Add a task to the top of ${long}` });
    /* The buttons are hidden as a set, so the set is what is read. */
    const set = add.locator("..");
    await expect(set).toHaveCSS("opacity", "0");
    await head.getByTestId("column-name").hover();
    await expect(set).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("seen-column-hover.png") });

    await page.mouse.move(0, 0);
    await add.focus();
    await expect(set).toHaveCSS("opacity", "1");
  });

  test("a waiting, a paused and a silent run each look different, at one height", async ({
    page,
    request,
  }, testInfo) => {
    const { projectId, task } = await project(page);
    for (const title of ["Asks", "Rests", "Gone quiet", "Works"]) await task(title);
    const api = agentApi(request, await connectAgent(page, projectId, "Runner"));
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const idOf = (title: string) =>
      board.tasks.find((t: { title: string }) => t.title === title).id as string;
    const start = async (title: string) =>
      (await (await api.post(`/api/tasks/${idOf(title)}/run`, { goal: title })).json()).run
        .id as string;

    const asks = await start("Asks");
    await api.patch(`/api/runs/${asks}`, { status: "waiting", step: "Which region?" });
    const rests = await start("Rests");
    await api.patch(`/api/runs/${rests}`, { status: "paused", step: "Held" });
    const quiet = await start("Gone quiet");
    await api.patch(`/api/runs/${quiet}`, { step: "Reading the logs" });
    await backdateRun(quiet, 10);
    const works = await start("Works");
    await api.patch(`/api/runs/${works}`, { step: "Writing the tests" });

    await page.goto(`/p/${projectId}`);
    const strip = (title: string) => card(page, title).getByTestId("card-run");
    await expect(strip("Asks")).toHaveAttribute("data-status", "waiting");
    await expect(strip("Rests")).toHaveAttribute("data-status", "paused");
    await expect(strip("Gone quiet")).toHaveAttribute("data-life", "silent");

    const ground = (title: string) =>
      strip(title).evaluate((el) => getComputedStyle(el).backgroundColor);
    const grounds = await Promise.all(["Asks", "Rests", "Works"].map(ground));
    expect(new Set(grounds).size).toBe(3);

    /* A waiting run wears the agent's face and lends its name's room to the question. */
    await expect(strip("Asks").getByText("Runner")).not.toBeInViewport();
    await expect(strip("Works").getByText("Runner")).toBeVisible();

    /* A silent run's words fade. */
    const step = strip("Gone quiet").getByTestId("card-run-step");
    await expect(step).toHaveCSS("opacity", "0.6");
    /* The whole step is a hover away. */
    await expect(strip("Asks").getByTestId("card-run-step")).toHaveAttribute(
      "title",
      /Which region\?/,
    );

    const heights = await Promise.all(
      ["Asks", "Rests", "Gone quiet", "Works"].map(
        async (title) => (await card(page, title).boundingBox())!.height,
      ),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath("seen-run-states.png") });
  });

  test("a new project's labels read as dot and word", async ({ page }) => {
    const { board, task } = await project(page);
    const labels = board.properties.find((p) => p.type === "multi_select")!;
    const first = labels.options[0];
    await task("Wears a label", { [labels.id]: [first.id] });
    await page.reload();
    await expect(card(page, "Wears a label").getByText(first.name)).toBeVisible();
  });

  test("yes, ship confirms in the accent and archive keeps its red", async ({ page }) => {
    const { projectId, read, task } = await project(page);
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["v1"] },
    });
    expect(made.ok()).toBeTruthy();
    const version = (await read()).properties.find((p) => p.name === "Version")!;
    const v1 = version.options[0];
    await page.request.patch(`/api/properties/${version.id}`, { data: { dated: true } });
    await page.request.patch(`/api/options/${v1.id}`, { data: { targetAt: "2026-01-01" } });
    await task("Out the door", { [version.id]: v1.id });

    await page.goto(`/p/${projectId}`);
    const todo = column(page, "Todo");
    await todo.getByTestId("column-archive").click();
    const archiveYes = page.getByRole("button", { name: /^Yes, archive/ });
    const red = await archiveYes.evaluate((el) => getComputedStyle(el).color);
    await page.getByRole("button", { name: "Cancel" }).click();

    const views = (await (await page.request.get(`/api/projects/${projectId}/board`)).json())
      .views as { id: string; isDefault: boolean }[];
    await page.request.patch(`/api/views/${views.find((v) => v.isDefault)!.id}`, {
      data: { groupById: version.id },
    });
    await page.reload();
    await column(page, "v1").getByTestId("column-ship").click();
    const ask = page.getByRole("alertdialog", { name: "Ship v1" });
    const yes = ask.getByRole("button", { name: /^(Yes, ship|Leave them)/ }).first();
    const accent = await yes.evaluate((el) => getComputedStyle(el).color);
    const wanted = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--accent-soft)";
      document.body.append(probe);
      const got = getComputedStyle(probe).color;
      probe.remove();
      return got;
    });
    expect(accent).toBe(wanted);
    expect(accent).not.toBe(red);
  });
});

test.describe("A list reads cleanly", () => {
  test("a row's ring runs the whole width, and Assignee shows the face and the name", async ({
    page,
  }, testInfo) => {
    const { read, task } = await project(page, "Ada Lovelace");
    const board = await read();
    const assignee = board.properties.find((p) => p.name === "Assignee")!;
    await task("Has somebody", { [assignee.id]: board.members[0].id });
    await page.reload();
    await addListView(page, "Rows");

    const row = listRow(page, "Has somebody");
    await expect(row.getByText("Ada Lovelace")).toBeVisible();

    await row.getByTestId("list-row-title").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    const ring = await row.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      return {
        shadow: after.boxShadow,
        ringWidth: parseFloat(after.width),
        rowWidth: el.getBoundingClientRect().width,
      };
    });
    expect(ring.shadow).not.toBe("none");
    expect(Math.abs(ring.ringWidth - ring.rowWidth)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath("seen-list-ring.png") });
  });
});

test.describe("A column header under a finger", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test("keeps its buttons in the row, with no hover", async ({ page }, testInfo) => {
    await project(page);
    const head = column(page, "Backlog");
    const set = head
      .getByRole("button", { name: "Add a task to the top of Backlog" })
      .locator("..");
    await expect(set).toHaveCSS("opacity", "1");
    await expect(set).toHaveCSS("position", "static");
    await page.screenshot({ path: testInfo.outputPath("seen-column-touch.png") });
  });
});
