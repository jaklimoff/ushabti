import { expect, test, type Page } from "@playwright/test";
import { card, column, createProject, register, unique } from "./helpers";

/**
 * An iteration is a select whose options always carry dates. The unit tests
 * hold each reader; this walks the screens a dated select already has, to see
 * that every one of them takes an iteration too. Settings and the picker are
 * the two `Sprints.test.tsx`; the rule grouping adds is `sprint-route.test.ts`.
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
