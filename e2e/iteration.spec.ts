import { expect, test, type Page } from "@playwright/test";
import {
  card,
  column,
  createProject,
  gotoSettings,
  propertyBox,
  register,
  unique,
  choose,
} from "./helpers";

/**
 * An iteration is a select whose options always carry dates. The unit tests
 * hold each reader; this walks the screens a dated select already has, to see
 * that every one of them takes an iteration too.
 */

type Option = { id: string; name: string; shippedAt: string | null };
type Board = {
  properties: { id: string; name: string; type: string; options: Option[] }[];
  views: { id: string; name: string; isDefault: boolean }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board;
}

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

test("Settings offers Iteration, and its options always show the date boxes", async ({ page }) => {
  await register(page);
  const projectId = await createProject(page, unique("Iteration"));
  await gotoSettings(page, projectId);

  await page.getByLabel("New property name").fill("Sprint");
  await choose(page.getByLabel("Type of the new property"), "Iteration");
  await page.getByPlaceholder("Options, separated by commas").fill("Sprint 1");
  const made = page.waitForResponse((r) => r.url().endsWith("/properties"));
  await page.getByRole("button", { name: "Add property" }).click();
  expect((await made).status()).toBe(201);

  const sprint = (await board(page, projectId)).properties.find((p) => p.name === "Sprint")!;
  expect(sprint.type).toBe("iteration");

  const box = propertyBox(page, "Sprint");
  await expect(box.getByText("Iteration", { exact: true })).toBeVisible();
  await expect(box.getByLabel("Options carry dates")).toHaveCount(0);
  await expect(box.getByLabel("Start of Sprint 1")).toBeVisible();
  await expect(box.getByLabel("Target of Sprint 1")).toBeVisible();
  await expect(box.getByLabel("Note of Sprint 1")).toBeVisible();
});

test("a board grouped by an iteration dates its header, filters 'is current', ships, and draws a roadmap", async ({
  page,
}) => {
  await register(page);
  const projectId = await createProject(page, unique("Iteration"));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Sprint", type: "iteration", options: ["Now", "Next"] },
  });
  expect(made.status()).toBe(201);
  let read = await board(page, projectId);
  const sprint = read.properties.find((p) => p.name === "Sprint")!;
  const [now, next] = sprint.options;

  for (const [option, start, target] of [
    [now, day(-3), day(3)],
    [next, day(4), day(10)],
  ] as const) {
    const res = await page.request.patch(`/api/options/${option.id}`, {
      data: { startAt: start, targetAt: target },
    });
    expect(res.ok()).toBeTruthy();
  }
  for (const [title, option] of [
    ["Alpha", now],
    ["Bravo", next],
  ] as const) {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [sprint.id]: option.id } },
    });
    expect(res.ok()).toBeTruthy();
  }

  const main = read.views.find((v) => v.isDefault)!;
  const grouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: sprint.id },
  });
  expect(grouped.ok()).toBeTruthy();
  // Grouping starts it on "is current"; this walk wants every sprint.
  await page.request.patch(`/api/views/${main.id}`, { data: { filters: { rules: [] } } });

  /* ---- the header carries the date and Ship ------------------------- */

  await page.goto(`/p/${projectId}`);
  await expect(column(page, "Now").getByTestId("column-date")).toBeVisible();
  await expect(column(page, "Next").getByTestId("column-date")).toBeVisible();
  await expect(column(page, "Now").getByRole("button", { name: "Close Now" })).toBeVisible();

  /* ---- the columns drag, and a drop moves the option ---------------- */

  await expect(page.getByRole("button", { name: "Reorder the column Now" })).toBeVisible();
  const moved = await page.request.patch(`/api/options/${now.id}`, {
    data: { afterId: next.id },
  });
  expect(moved.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("column-name")).toHaveText([/next/i, /now/i]);

  /* ---- "is current" keeps the sprint whose dates hold today --------- */

  const current = await page.request.patch(`/api/views/${main.id}`, {
    data: { filters: { rules: [{ propertyId: sprint.id, op: "is", values: ["__current__"] }] } },
  });
  expect(current.ok()).toBeTruthy();
  await page.reload();
  await expect(card(page, "Alpha")).toBeVisible();
  await expect(card(page, "Bravo")).toHaveCount(0);
  await page.request.patch(`/api/views/${main.id}`, { data: { filters: { rules: [] } } });

  /* ---- Ship writes the day ------------------------------------------ */

  const shipped = await page.request.post(`/api/options/${next.id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();
  read = await board(page, projectId);
  expect(
    read.properties.find((p) => p.id === sprint.id)!.options.find((o) => o.id === next.id)!
      .shippedAt,
  ).not.toBeNull();

  /* ---- a roadmap draws one bar per sprint --------------------------- */

  const roadmap = await page.request.post(`/api/projects/${projectId}/views`, {
    data: { name: "Plan", kind: "roadmap", groupById: sprint.id },
  });
  expect(roadmap.status()).toBe(201);
  await page.goto(`/p/${projectId}`);
  await page.getByTestId("view-pill").filter({ hasText: "Plan" }).click();
  await expect(page.getByTestId("roadmap-row")).toHaveCount(2);
});

test("a picker opens on the current sprint, and grouping by one starts on 'is current'", async ({
  page,
}) => {
  await register(page);
  const projectId = await createProject(page, unique("Current"));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Sprint", type: "iteration", options: ["Old", "Now", "Next"] },
  });
  expect(made.status()).toBe(201);
  const sprint = (await board(page, projectId)).properties.find((p) => p.name === "Sprint")!;
  const [old, now, next] = sprint.options;
  // Old is shipped by hand: a sprint past its end stays open until somebody ships it.
  for (const [option, start, target, shippedAt] of [
    [old, day(-10), day(-4), day(-4)],
    [now, day(-3), day(3), undefined],
    [next, day(4), day(10), undefined],
  ] as const) {
    const res = await page.request.patch(`/api/options/${option.id}`, {
      data: { startAt: start, targetAt: target, shippedAt },
    });
    expect(res.ok()).toBeTruthy();
  }
  for (const [title, option] of [
    ["Alpha", old],
    ["Bravo", now],
  ] as const) {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [sprint.id]: option.id } },
    });
    expect(res.ok()).toBeTruthy();
  }

  /* ---- the picker marks the current sprint and opens on it ---------- */

  await page.goto(`/p/${projectId}`);
  await card(page, "Alpha").click();
  const field = page.getByTestId("task-panel").locator('[data-property="Sprint"]');
  await field.getByRole("button", { name: /Old/ }).click();
  await expect(field.getByRole("option", { name: /Now/ })).toContainText("current");
  await expect(field.getByRole("option", { name: /Next/ })).not.toContainText("current");
  await expect(field.locator('[data-at="true"]')).toHaveText(/Now/);
  await page.keyboard.press("Escape");

  /* ---- grouping by it adds "is current" in the same write ----------- */

  await gotoSettings(page, projectId, "views");
  const write = page.waitForResponse(
    (r) => /\/api\/views\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await choose(page.getByLabel("Grouping property of the view Board"), "Sprint");
  expect((await write).ok()).toBeTruthy();
  const view = (
    (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      views: {
        isDefault: boolean;
        filters: { rules: { propertyId: string; values: string[] }[] };
      }[];
    }
  ).views.find((v) => v.isDefault)!;
  expect(view.filters.rules).toEqual([
    expect.objectContaining({ propertyId: sprint.id, values: ["__current__"] }),
  ]);

  await page.goto(`/p/${projectId}`);
  await expect(
    page.getByTestId("filter-chip").filter({ hasText: "Sprint is current" }),
  ).toBeVisible();
  await expect(card(page, "Bravo")).toBeVisible();
  await expect(card(page, "Alpha")).toHaveCount(0);

  /* ---- a person whose own filter already asks about it gets no second rule */

  const views = (await board(page, projectId)).views;
  const main = views.find((v) => v.isDefault)!;
  const status = (await board(page, projectId)).properties.find((p) => p.name === "Status")!;
  await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: status.id, filters: { rules: [] } },
  });
  const lens = await page.request.put(`/api/views/${main.id}/lens`, {
    data: { filters: { rules: [{ propertyId: sprint.id, op: "is", values: [next.id] }] } },
  });
  expect(lens.ok()).toBeTruthy();
  const regrouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: sprint.id },
  });
  expect(regrouped.ok()).toBeTruthy();
  const after = (
    (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      views: { isDefault: boolean; filters: { rules: unknown[] } }[];
    }
  ).views.find((v) => v.isDefault)!;
  expect(after.filters.rules).toEqual([]);
});
