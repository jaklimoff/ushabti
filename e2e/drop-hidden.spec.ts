import { expect, test, type Page } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * The rest of this file moved down: the drops are
 * `src/lib/__tests__/drop-hidden-route.test.ts`, the questions are
 * `src/components/board/DropHidden.test.tsx`. The race of writes to one task
 * stays here, because one in-memory database answers one request at a time.
 */

type Property = { id: string; name: string; options: { id: string; name: string }[] };
type Board = {
  properties: Property[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};
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

test.describe("A value its task does not show is dropped", () => {
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
