import { expect, test, type Page } from "@playwright/test";
import { createProject, register, settles, unique } from "./helpers";

/*
 * A person drags their projects into their own order on Home, and every
 * place that lists projects reads it. Who else's list moves, an agent and a
 * stranger are in `project-order-route.test.ts`; the keyboard is in
 * `ProjectList.test.tsx`.
 */

const cards = (page: Page) => page.getByTestId("project-card");

async function homeOrder(page: Page, names: string[]) {
  const texts = await cards(page).allInnerTexts();
  return texts.map((t) => names.find((n) => t.includes(n)));
}

test("a project dragged on Home stays there, and the switcher and the API agree", async ({
  page,
}) => {
  await register(page, "Orderer");
  const names = ["Alpha", "Bravo", "Charlie"].map((n) => unique(n));
  const ids: string[] = [];
  for (const name of names) ids.push(await createProject(page, name));
  const [a, b, c] = names;

  await page.goto("/projects");
  // Each new project goes to the top.
  await expect.poll(() => homeOrder(page, names)).toEqual([c, b, a]);

  // Alpha's grip, carried onto Charlie at the front.
  const from = cards(page).filter({ hasText: a });
  await from.hover();
  const grip = page.getByRole("button", { name: `Move the project ${a}` });
  const start = await grip.boundingBox();
  const target = await cards(page).filter({ hasText: c }).boundingBox();
  if (!start || !target) throw new Error("No card to drag");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 4 });
  const steps = 16;
  const to = { x: target.x + target.width / 3, y: target.y + target.height / 2 };
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      start.x + ((to.x - start.x) * i) / steps,
      start.y + ((to.y - start.y) * i) / steps,
    );
  }
  await page.waitForTimeout(150);
  await settles(page, /\/api\/projects\/[0-9a-f-]+\/position$/, () => page.mouse.up());
  await expect.poll(() => homeOrder(page, names)).toEqual([a, c, b]);

  await page.reload();
  await expect.poll(() => homeOrder(page, names)).toEqual([a, c, b]);

  const { projects } = await (await page.request.get("/api/projects")).json();
  expect(projects.map((p: { name: string }) => p.name)).toEqual([a, c, b]);

  await page.goto(`/p/${ids[1]}`);
  await page.getByTestId("project-switcher").click();
  // The switcher reads `GET /api/projects` when it opens.
  await expect
    .poll(async () => {
      const rows = await page.getByRole("menuitemradio").allInnerTexts();
      return rows.map((t) => names.find((n) => t.includes(n)));
    })
    .toEqual([a, c, b]);
});
