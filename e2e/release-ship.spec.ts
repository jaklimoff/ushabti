import { execFile } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

const SHIP_SH = path.resolve(process.cwd(), ".setmaat/release/ship.sh");

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  tasks: { id: string; title: string }[];
};

/** ship.sh run as Setmaat runs release.after: an agent's token and the version. */
function runShip(env: Record<string, string>) {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("The tests need a baseURL.");
  return new Promise<{ code: number; out: string; err: string }>((done) => {
    execFile(
      "sh",
      [SHIP_SH],
      {
        env: {
          ...process.env,
          USHABTI_TOKEN: undefined,
          USHABTI_URL: base.replace(/\/$/, ""),
          SETMAAT_RELEASE_VERSION: "0.26.0",
          ...env,
        },
      },
      (error, out, err) => done({ code: error ? Number(error.code ?? 1) : 0, out, err }),
    );
  });
}

/*
 * The last step of a press of Release: the tasks are over and in no release,
 * as Setmaat leaves them after the move, and ship.sh makes the release, ships
 * it and takes them. The changelog then lists them under it.
 */
test("ship.sh ships the release on the board, and the changelog lists its tasks", async ({
  page,
}, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Release"));
  expect((await page.request.post(`/api/projects/${projectId}/releases`)).ok()).toBe(true);

  const read = async (): Promise<Board> =>
    (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const status = (await read()).properties.find((p) => p.name === "Status")!;
  const done = status.options.find((o) => o.name === "Done")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const task = async (title: string, option: string) =>
    expect(
      (
        await page.request.post(`/api/projects/${projectId}/tasks`, {
          data: { title, values: { [status.id]: option } },
        })
      ).ok(),
    ).toBeTruthy();
  await task("Alpha released", done.id);
  await task("Bravo released", done.id);
  await task("Charlie waits", backlog.id);

  const agent = await page.request.post(`/api/projects/${projectId}/agents`, {
    data: { name: "Loop" },
  });
  expect(agent.ok()).toBeTruthy();
  const agentId = ((await agent.json()) as { agent: { id: string } }).agent.id;
  const issued = await page.request.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
    data: { name: "release" },
  });
  expect(issued.ok()).toBeTruthy();
  const token = ((await issued.json()) as { secret: string }).secret;

  /* No token: one sentence, and the board is not asked. */
  const refused = await runShip({});
  expect(refused.code).toBe(1);
  expect(refused.err).toBe(
    "ship.sh: USHABTI_TOKEN is not set, so 0.26.0 was not shipped on the board.\n",
  );

  const shipped = await runShip({ USHABTI_TOKEN: token });
  expect(shipped.err).toBe("");
  expect(shipped.code).toBe(0);
  expect(shipped.out).toMatch(/^Release 0\.26\.0 made, due \d{4}-\d{2}-\d{2}\n/);
  expect(shipped.out).toMatch(
    /Release 0\.26\.0 shipped \d{4}-\d{2}-\d{2}: 2 archived, 0 moved, 2 taken from no release\n$/,
  );

  const board = await read();
  expect(board.tasks.map((t) => t.title)).toEqual(["Charlie waits"]);

  /* Shipped already: the board refuses, and ship.sh says so in one sentence. */
  const again = await runShip({ USHABTI_TOKEN: token });
  expect(again.code).toBe(1);
  expect(again.err).toMatch(
    /^ship\.sh: the board refused to ship 0\.26\.0 \(.+\), and nothing before this step is undone\.\n$/,
  );

  await page.goto(`/p/${projectId}/changelog`);
  const entries = page.getByTestId("changelog-entry");
  await expect(entries).toHaveCount(1);
  await expect(entries.getByRole("heading")).toHaveText("0.26.0");
  await expect(entries.getByTestId("changelog-task")).toHaveText([
    /Alpha released/,
    /Bravo released/,
  ]);
  await page.screenshot({ path: testInfo.outputPath("seen-release-changelog.png") });
});
