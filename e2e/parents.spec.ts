import { expect, test, type APIRequestContext } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, settles, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/** Adds a task, reads the key its panel shows, and closes the panel again. */
async function addAndKey(page: Page, title: string): Promise<string> {
  await addTask(page, "Todo", title);
  const key = (await page.getByTestId("task-key").innerText()).trim();
  await page.getByRole("button", { name: "Close task" }).click();
  return key;
}

/** Picks from the open task's menu and names the other task in the box. */
async function pick(page: Page, item: "add-parent" | "add-child", key: string) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId(item).click();
  const box = page.getByTestId(
    item === "add-parent" ? "link-search-parent" : "link-search-children",
  );
  await box.fill(key);
  await settles(page, /\/api\/tasks\/[0-9a-f-]+\/parent$/, () => box.press("Enter"));
}

/** The calls an agent makes, with the token in place of a session cookie. */
function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (path: string) => request.get(path, { headers }),
    put: (path: string, data: unknown = {}) => request.put(path, { headers, data }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    del: (path: string) => request.delete(path, { headers }),
  };
}

test.describe("What a task is part of", () => {
  test("the panel sets a parent, lists the parts, and a part is never a blocker", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Parts"));

    const epicKey = await addAndKey(page, "The whole epic");
    const oneKey = await addAndKey(page, "Part one");
    const twoKey = await addAndKey(page, "Part two");

    await card(page, "Part one").click();
    await pick(page, "add-parent", epicKey);
    const parentList = page.getByTestId("links-parent");
    await expect(parentList.getByTestId("link-row")).toHaveCount(1);
    await expect(parentList).toContainText("The whole epic");

    /* A part is not a blocker: no Blocked by, and no chain on either card. */
    await expect(page.getByTestId("links-blockedBy")).toHaveCount(0);
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(card(page, "Part one").getByTestId("card-chain")).toHaveCount(0);
    await expect(card(page, "The whole epic").getByTestId("card-chain")).toHaveCount(0);

    /* The Parent row opens the parent, and it lists its parts. */
    await card(page, "Part one").click();
    await parentList.getByRole("button", { name: `Open ${epicKey} The whole epic` }).click();
    await expect(page.getByTestId("task-key")).toHaveText(epicKey);
    const children = page.getByTestId("links-children");
    await expect(children.getByTestId("link-row")).toHaveCount(1);
    await expect(page.getByTestId("links-blocks")).toHaveCount(0);

    /* The parent may wait on its own part: the parent row is not in the
       circle check, so this is no circle. */
    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByTestId("add-blocker").click();
    const blockerBox = page.getByTestId("link-search-blockedBy");
    await blockerBox.fill(oneKey);
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/blockers$/, () => blockerBox.press("Enter"));
    await expect(page.getByTestId("link-refused")).toHaveCount(0);
    await expect(page.getByTestId("links-blockedBy").getByTestId("link-row")).toHaveCount(1);

    /* A second part by the menu, and the parts are in board order. It had
       another parent, and the panel says where it left. */
    await page.getByRole("button", { name: "Close task" }).click();
    const sideKey = await addAndKey(page, "Side work");
    await card(page, "Part two").click();
    await pick(page, "add-parent", sideKey);
    await page.getByRole("button", { name: "Close task" }).click();
    await card(page, "The whole epic").click();
    await pick(page, "add-child", twoKey);
    await expect(page.getByTestId("toast")).toHaveText(
      `${twoKey} left ${sideKey} and is now part of this task.`,
    );
    await expect(children.getByTestId("link-row")).toHaveCount(2);
    await expect(children.getByTestId("link-row").nth(0)).toContainText("Part one");
    await expect(children.getByTestId("link-row").nth(1)).toContainText("Part two");

    /* A part that is over is struck through, and its row still opens it. */
    await page.getByRole("button", { name: "Close task" }).click();
    await card(page, "Part two").click();
    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByTestId("archive-task").click();
    await expect(page.getByTestId("archived-row")).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();

    await card(page, "The whole epic").click();
    const over = children.getByRole("button", { name: `Open ${twoKey} Part two` });
    await expect(over.locator("span").nth(1)).toHaveClass(/linkOver/);
    await expect(
      children
        .getByRole("button", { name: `Open ${oneKey} Part one` })
        .locator("span")
        .nth(1),
    ).not.toHaveClass(/linkOver/);
    await over.click();
    await expect(page.getByTestId("task-key")).toHaveText(twoKey);
    await expect(page.getByTestId("archived-row")).toBeVisible();

    /* A part cannot have parts: refused in the row, with one sentence. */
    await page.getByRole("button", { name: "Close task" }).click();
    await card(page, "Part one").click();
    await page.getByRole("button", { name: "Task menu" }).click();
    await page.getByTestId("add-child").click();
    const childBox = page.getByTestId("link-search-children");
    await childBox.fill(twoKey);
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/parent$/, () => childBox.press("Enter"));
    await expect(page.getByTestId("link-refused")).toHaveText(
      `${oneKey} is part of ${epicKey}, so it cannot have parts of its own.`,
    );

    /* The ✕ takes the part out of its parent. */
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/parent$/, () =>
      parentList.getByRole("button", { name: `Unlink ${epicKey}` }).click(),
    );
    await expect(parentList).toHaveCount(0);
    /* The blocker of the same two tasks is still there. */
    await expect(page.getByTestId("links-blocks").getByTestId("link-row")).toHaveCount(1);
  });

  test("an agent sets, replaces and removes a parent, and the server holds one level", async ({
    page,
    request,
  }) => {
    await register(page, "Parts Owner");
    const projectId = await createProject(page, unique("Agent parts"));
    for (const title of ["Epic A", "Epic B", "Child", "Loose"]) await addAndKey(page, title);

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Splitter");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Splitter" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const secret = page.getByTestId("agent-secret").first();
    await expect(secret).toBeVisible();
    const token = ((await secret.locator("code").first().textContent()) ?? "").trim();
    const api = agentApi(request, token);

    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const byTitle = (title: string) =>
      board.tasks.find((t: { title: string }) => t.title === title) as { id: string; key: string };
    const [a, b, child, loose] = ["Epic A", "Epic B", "Child", "Loose"].map(byTitle);
    const detail = async (id: string) => (await (await api.get(`/api/tasks/${id}`)).json()).task;

    expect((await api.put(`/api/tasks/${child.id}/parent`, { parentId: a.id })).status()).toBe(200);
    expect((await detail(child.id)).parent).toMatchObject({ id: a.id, key: a.key, over: false });
    expect((await detail(a.id)).children.map((t: { id: string }) => t.id)).toEqual([child.id]);
    /* A part is not a blocker, on the board or in the detail. */
    expect((await detail(child.id)).blockedBy).toEqual([]);
    expect((await detail(child.id)).links.blockedBy).toEqual([]);
    expect((await detail(a.id)).links.blocks).toEqual([]);

    /* A second PUT replaces: one parent at most. */
    const moved = await api.put(`/api/tasks/${child.id}/parent`, { parentId: b.id });
    expect(moved.status()).toBe(200);
    expect(await moved.json()).toMatchObject({ ok: true, left: a.key });
    expect((await detail(child.id)).parent.id).toBe(b.id);
    expect((await detail(a.id)).children).toEqual([]);
    expect((await detail(b.id)).children.map((t: { id: string }) => t.id)).toEqual([child.id]);

    const lines = (await detail(child.id)).activity.filter(
      (l: { kind: string }) => l.kind === "link",
    );
    expect(lines[0].data).toMatchObject({ action: "parented", parentKey: b.key });

    /* One level, refused with 409 and a sentence each time. */
    const self = await api.put(`/api/tasks/${loose.id}/parent`, { parentId: loose.id });
    expect(self.status()).toBe(409);
    expect((await self.json()).error).toBe("A task cannot be part of itself.");
    const deeper = await api.put(`/api/tasks/${loose.id}/parent`, { parentId: child.id });
    expect(deeper.status()).toBe(409);
    expect((await deeper.json()).error).toBe(
      `${child.key} is part of ${b.key}, so it cannot have parts of its own.`,
    );
    const hasParts = await api.put(`/api/tasks/${b.id}/parent`, { parentId: a.id });
    expect(hasParts.status()).toBe(409);
    expect((await hasParts.json()).error).toBe(
      `${b.key} has parts of its own, so it cannot be part of another task.`,
    );

    /* Archive keeps the link, and the archived part reads as over. */
    expect((await api.post(`/api/tasks/${child.id}/archive`)).status()).toBe(200);
    expect((await detail(b.id)).children).toMatchObject([{ id: child.id, over: true }]);
    expect((await detail(child.id)).parent).toMatchObject({ id: b.id, over: false });

    expect((await api.del(`/api/tasks/${child.id}/parent`)).status()).toBe(200);
    expect((await detail(child.id)).parent).toBeNull();
    expect((await detail(b.id)).children).toEqual([]);
    const removed = (await detail(child.id)).activity.filter(
      (l: { kind: string }) => l.kind === "link",
    );
    expect(removed[0].data).toMatchObject({ action: "unparented", parentKey: b.key });

    /* A deleted parent is off the board, so its row refuses nothing. */
    expect((await api.put(`/api/tasks/${loose.id}/parent`, { parentId: a.id })).status()).toBe(200);
    expect((await page.request.delete(`/api/tasks/${a.id}`)).status()).toBe(200);
    expect((await detail(loose.id)).parent).toBeNull();
    expect((await api.put(`/api/tasks/${b.id}/parent`, { parentId: loose.id })).status()).toBe(200);

    /* Put back, the parent would make a second level, so the part leaves it. */
    expect((await page.request.post(`/api/tasks/${a.id}/restore`)).status()).toBe(200);
    expect((await detail(loose.id)).parent).toBeNull();
    expect((await detail(a.id)).children).toEqual([]);
    expect((await detail(loose.id)).children.map((t: { id: string }) => t.id)).toEqual([b.id]);
    const left = (await detail(loose.id)).activity.filter(
      (l: { kind: string }) => l.kind === "link",
    );
    expect(left[0].data).toMatchObject({ action: "unparented", parentKey: a.key });
  });
});
