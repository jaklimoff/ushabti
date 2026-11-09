import { expect, test, type Page } from "@playwright/test";
import { createProject, listOrder, register, unique } from "./helpers";

/*
 * `GET /api/views/{viewId}/tasks`: the tasks a view shows, in its order, for
 * an agent to work from. The queue is the screen's own reading, so the test
 * holds it against a list a person sees.
 */

type Prop = { id: string; name: string; options?: { id: string; name: string }[] };

async function boardOf(page: Page, projectId: string) {
  const data = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const prop = (name: string) => (data.properties as Prop[]).find((p) => p.name === name)!;
  const option = (property: string, name: string) =>
    prop(property).options!.find((o) => o.name === name)!.id;
  return { data, prop, option };
}

async function agentToken(page: Page, projectId: string, name: string) {
  const { agent } = await (
    await page.request.post(`/api/projects/${projectId}/agents`, { data: { name } })
  ).json();
  const { secret } = await (
    await page.request.post(`/api/projects/${projectId}/agents/${agent.id}/tokens`, { data: {} })
  ).json();
  return {
    id: agent.id as string,
    headers: { Authorization: `Bearer ${secret}`, "x-forwarded-for": unique("198.51.100") },
  };
}

test("a view's queue is the list on screen, with me as the caller and no lens", async ({
  page,
}, testInfo) => {
  await register(page, "Queue Owner");
  const projectId = await createProject(page, unique("Queue"));
  const { data, prop, option } = await boardOf(page, projectId);
  const person = (data.members as { id: string; name: string }[]).find(
    (m) => m.name === "Queue Owner",
  )!.id;
  const priority = prop("Priority");
  const assignee = prop("Assignee");
  const agent = await agentToken(page, projectId, "Picker");

  // A list ordered by Priority, with no rule: the queue against the screen.
  const ordered = await (
    await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "By priority", kind: "list" },
    })
  ).json();
  const orderedId: string = ordered.view.id;
  expect(
    (
      await page.request.patch(`/api/views/${orderedId}`, {
        data: { sort: { columnId: priority.id, direction: "asc" } },
      })
    ).status(),
  ).toBe(200);

  const made: Record<string, { id: string; key: string }> = {};
  const add = async (title: string, values: Record<string, unknown>) => {
    const { task } = await (
      await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title, values } })
    ).json();
    made[title] = { id: task.id, key: task.key };
  };
  await add("Low one", { [priority.id]: option("Priority", "Low"), [assignee.id]: agent.id });
  await add("Urgent one", { [priority.id]: option("Priority", "Urgent"), [assignee.id]: agent.id });
  await add("No priority", { [assignee.id]: agent.id });
  await add("High for the person", {
    [priority.id]: option("Priority", "High"),
    [assignee.id]: person,
  });
  await add("Archived urgent", { [priority.id]: option("Priority", "Urgent") });
  expect(
    (await page.request.post(`/api/tasks/${made["Archived urgent"].id}/archive`)).status(),
  ).toBe(200);

  const queueOf = async (viewId: string, headers?: Record<string, string>) => {
    const res = await page.request.get(`/api/views/${viewId}/tasks`, { headers });
    expect(res.status()).toBe(200);
    return (await res.json()) as {
      view: { id: string; name: string };
      tasks: { id: string; key: string }[];
    };
  };
  const titleOf = (key: string) => Object.entries(made).find(([, t]) => t.key === key)![0];

  // The same tasks in the same order as the list a person opens.
  await page.goto(`/p/${projectId}?view=${orderedId}`);
  await expect(page.getByTestId("list-row")).toHaveCount(4);
  const onScreen = await listOrder(page);
  const queue = await queueOf(orderedId, agent.headers);
  expect(queue.view).toEqual({ id: orderedId, name: "By priority" });
  expect(queue.tasks.map((t) => titleOf(t.key))).toEqual(onScreen);
  expect(onScreen).toEqual(["Urgent one", "High for the person", "Low one", "No priority"]);
  await page.screenshot({ path: testInfo.outputPath("seen-queue-list.png") });

  // "Assignee is me" reads the caller: the agent gets its own, the person theirs.
  const mine = await (
    await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "Mine", kind: "list" },
    })
  ).json();
  const mineId: string = mine.view.id;
  expect(
    (
      await page.request.patch(`/api/views/${mineId}`, {
        data: {
          filters: { rules: [{ propertyId: assignee.id, op: "is", values: ["__me__"] }] },
          sort: { columnId: priority.id, direction: "asc" },
        },
      })
    ).status(),
  ).toBe(200);
  expect((await queueOf(mineId, agent.headers)).tasks.map((t) => titleOf(t.key))).toEqual([
    "Urgent one",
    "Low one",
    "No priority",
  ]);
  expect((await queueOf(mineId)).tasks.map((t) => titleOf(t.key))).toEqual(["High for the person"]);

  // A lens of the caller does not change the answer.
  expect(
    (
      await page.request.put(`/api/views/${orderedId}/lens`, {
        data: {
          filters: { rules: [{ propertyId: assignee.id, op: "is", values: ["__me__"] }] },
          sort: { columnId: priority.id, direction: "desc" },
        },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByTestId("list-row")).toHaveCount(1);
  expect((await queueOf(orderedId)).tasks).toEqual(queue.tasks);

  // A token of another project, and a view that is gone, answer 404.
  const otherId = await createProject(page, unique("Elsewhere"));
  const stranger = await agentToken(page, otherId, "Stranger");
  const foreign = await page.request.get(`/api/views/${orderedId}/tasks`, {
    headers: stranger.headers,
  });
  expect(foreign.status()).toBe(404);
  expect((await foreign.json()).error).toBe("That view does not exist.");

  expect((await page.request.delete(`/api/views/${mineId}`)).status()).toBe(200);
  const gone = await page.request.get(`/api/views/${mineId}/tasks`, { headers: agent.headers });
  expect(gone.status()).toBe(404);
  expect((await gone.json()).error).toBe("That view does not exist.");
});
