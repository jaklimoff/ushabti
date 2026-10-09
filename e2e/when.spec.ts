import { expect, test, type Page } from "@playwright/test";
import { createProject, inDatabase, register, unique } from "./helpers";

type Property = {
  id: string;
  name: string;
  type: string;
  config: { when?: { propertyId: string; optionIds: string[] } };
  options: { id: string; name: string }[];
};
type Board = { properties: Property[]; views: { id: string; isDefault: boolean }[] };

async function board(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/** A project with a Type select of Bug and Story, and the read board. */
async function typed(page: Page, name: string) {
  const projectId = await createProject(page, unique(name));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Type", type: "select", options: ["Bug", "Story"] },
  });
  expect(made.ok()).toBeTruthy();
  const read = await board(page, projectId);
  const of = (n: string) => read.properties.find((p) => p.name === n)!;
  const type = of("Type");
  const option = (n: string) => type.options.find((o) => o.name === n)!.id;
  return { projectId, read, of, type, bug: option("Bug"), story: option("Story") };
}

/*
 * The rest of this spec went down: Settings and the board to
 * `src/components/settings/When.test.tsx`, who may set a rule to
 * `src/lib/__tests__/when-route.test.ts`. The race stays, because only a real
 * server with a pool of connections can run two writes at once.
 */
test.describe("A property says when it shows", () => {
  test("two rules written at once cannot close a circle", async ({ page }) => {
    await register(page);
    const { projectId, of, type, bug } = await typed(page, "When race");
    const priority = of("Priority");
    const urgent = priority.options.find((o) => o.name === "Urgent")!.id;
    const rules = async () =>
      (await board(page, projectId)).properties.filter((p) => p.config.when).map((p) => p.id);
    for (let round = 0; round < 5; round++) {
      for (const id of [priority.id, type.id]) {
        await page.request.patch(`/api/properties/${id}`, { data: { when: null } });
      }
      const answers = await Promise.all([
        page.request.patch(`/api/properties/${priority.id}`, {
          data: { when: { propertyId: type.id, optionIds: [bug] } },
        }),
        page.request.patch(`/api/properties/${type.id}`, {
          data: { when: { propertyId: priority.id, optionIds: [urgent] } },
        }),
      ]);
      const statuses = answers.map((a) => a.status()).sort();
      expect(statuses).toEqual([200, 400]);
      const refused = answers.find((a) => a.status() === 400)!;
      expect((await refused.json()).error).toMatch(/circle/);
      /* The one that passed reads on the board; a circle would read as none. */
      expect(await rules()).toHaveLength(1);
      const stored = await inDatabase(async (client) => {
        const { rows } = await client.query<{ n: number }>(
          "select count(*)::int as n from properties where id = any($1) and config ? 'when'",
          [[priority.id, type.id]],
        );
        return rows[0].n;
      });
      expect(stored).toBe(1);
    }
  });
});
