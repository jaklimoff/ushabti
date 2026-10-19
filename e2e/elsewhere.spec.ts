import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createProject, gotoSettings, inDatabase, register, unique } from "./helpers";

/*
 * A person's project stream also rings `elsewhere` when another of their
 * projects changes, so a page can follow every project on the one socket it
 * already holds. It says where and never what, it follows the memberships on
 * every ping, an agent never hears it, and the board never reads itself on it.
 */

/** The stream's own ping, `LISTEN_TOUCH_MS`, with room to spare. */
const PING = 25_000;

type Heard = { event: string; data: unknown }[];

/** Holds a stream open from the test itself, and keeps what it hears. */
async function listen(
  testInfo: TestInfo,
  path: string,
  headers: Record<string, string>,
): Promise<{ heard: Heard; pings: () => number; stop: () => void }> {
  const heard: Heard = [];
  let pings = 0;
  const abort = new AbortController();
  const res = await fetch(new URL(path, testInfo.project.use.baseURL), {
    headers,
    signal: abort.signal,
  });
  expect(res.ok).toBeTruthy();
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let rest = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        rest += value;
        let end: number;
        while ((end = rest.indexOf("\n\n")) >= 0) {
          const block = rest.slice(0, end);
          rest = rest.slice(end + 2);
          if (block.startsWith(": ping")) pings += 1;
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) heard.push({ event, data: data ? JSON.parse(data) : null });
        }
      }
    } catch {
      /* stopped */
    }
  })();
  await expect.poll(() => heard.some((h) => h.event === "ready")).toBe(true);
  return { heard, pings: () => pings, stop: () => abort.abort() };
}

async function cookieOf(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function makeTask(page: Page, projectId: string, title: string) {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.ok()).toBeTruthy();
}

function rings(heard: Heard, projectId: string) {
  return heard.filter(
    (h) => h.event === "elsewhere" && (h.data as { projectId: string }).projectId === projectId,
  ).length;
}

async function connectAgent(page: Page, projectId: string, name: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  const box = page.getByTestId("agent-box").filter({ hasText: name });
  await box.getByRole("button", { name: "Connect" }).click();
  await box.getByRole("button", { name: "Make token" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
  expect(token).toMatch(/^ush_/);
  return token;
}

test.describe("A person's project stream rings elsewhere", () => {
  test("another project's change rings with only its id, and the board does not read itself", async ({
    page,
  }, testInfo) => {
    await register(page, "Elsewhere Watcher");
    const here = await createProject(page, unique("Here"));
    const there = await createProject(page, unique("There"));
    await page.goto(`/p/${here}`);

    let reads = 0;
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === `/api/projects/${here}/board`) reads += 1;
    });
    const stream = await listen(testInfo, `/api/projects/${here}/stream`, await cookieOf(page));
    /* The board's own read on `ready` comes and goes before the count. */
    await page.waitForTimeout(1500);
    reads = 0;

    await makeTask(page, there, "Made elsewhere");
    await expect.poll(() => rings(stream.heard, there)).toBeGreaterThan(0);
    const said = stream.heard.find((h) => h.event === "elsewhere");
    expect(said?.data).toEqual({ projectId: there });
    // This project's own change is a change, never elsewhere.
    expect(rings(stream.heard, here)).toBe(0);

    await page.waitForTimeout(1500);
    expect(reads).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("seen-elsewhere-board.png") });
    stream.stop();
  });

  test("a project joined while the stream is open rings within one ping, and one left stops", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(4 * PING + 30_000);
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await register(ownerPage, "Other Owner");
    const theirs = await createProject(ownerPage, unique("Theirs"));

    const me = await register(page, "Joiner");
    const mine = await createProject(page, unique("Mine"));
    const stream = await listen(testInfo, `/api/projects/${mine}/stream`, await cookieOf(page));

    await inDatabase((client) =>
      client.query(
        `insert into project_members (project_id, user_id, role, position)
         select $1, id, 'member', 'n' from users where email = $2`,
        [theirs, me.email],
      ),
    );
    // The join itself rings once, at the next ping.
    await expect.poll(() => rings(stream.heard, theirs), { timeout: PING + 10_000 }).toBe(1);
    await makeTask(ownerPage, theirs, "Seen by the joiner");
    await expect.poll(() => rings(stream.heard, theirs)).toBe(2);

    await inDatabase((client) =>
      client.query(
        `delete from project_members where project_id = $1
           and user_id = (select id from users where email = $2)`,
        [theirs, me.email],
      ),
    );
    // The leave rings once too, at the next ping, and then nothing.
    await expect.poll(() => rings(stream.heard, theirs), { timeout: PING + 10_000 }).toBe(3);
    await makeTask(ownerPage, theirs, "Not seen any more");
    await page.waitForTimeout(2000);
    expect(rings(stream.heard, theirs)).toBe(3);

    stream.stop();
    await owner.close();
  });

  test("an agent's stream never rings elsewhere", async ({ page }, testInfo) => {
    await register(page, "Agent Keeper");
    const here = await createProject(page, unique("Agent Here"));
    const there = await createProject(page, unique("Agent There"));
    const name = unique("Watcher");
    const token = await connectAgent(page, here, name);
    /* Even an agent that is somehow a member of a second project. */
    await inDatabase((client) =>
      client.query(
        `insert into project_members (project_id, user_id, role, position)
         select $1, id, 'member', 'n' from users where name = $2 and kind = 'agent'`,
        [there, name],
      ),
    );

    const stream = await listen(testInfo, `/api/projects/${here}/stream`, {
      authorization: `Bearer ${token}`,
    });
    await makeTask(page, there, "Elsewhere for the agent");
    await makeTask(page, here, "Here for the agent");
    await expect
      .poll(() =>
        stream.heard.some(
          (h) => h.event === "change" && (h.data as { projectId: string }).projectId === here,
        ),
      )
      .toBe(true);
    await page.waitForTimeout(1500);
    expect(stream.heard.filter((h) => h.event === "elsewhere")).toEqual([]);
    stream.stop();
  });
});
