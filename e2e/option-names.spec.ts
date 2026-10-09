import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

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
 * a second person, an agent. The rest of this file is in
 * `option-names-route.test.ts` and `OptionNames.test.tsx`; this one needs the
 * real database.
 */
test.describe("One name, one option", () => {
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
});
