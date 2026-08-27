import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type Account = { email: string; password: string; name: string };

export async function register(page: Page, name = "Test Person"): Promise<Account> {
  const email = `${unique("user")}@example.com`;
  const password = "ushabti-secret";
  await page.goto("/register");
  await page.getByPlaceholder("Ada Lovelace").fill(name);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("At least 8 characters").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/projects");
  return { email, password, name };
}

export async function signIn(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(account.email);
  await page.getByPlaceholder("Your password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/projects");
}

export async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects");
  const newButton = page.getByRole("button", { name: /New project/i });
  if (await newButton.count()) await newButton.first().click();
  await page.getByPlaceholder("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/);
  await expect(page.getByText("BACKLOG")).toBeVisible();
  return page.url().split("/p/")[1].split("?")[0];
}

/** Settings is five pages now, so a test says which one it wants. */
export async function gotoSettings(
  page: Page,
  projectId: string,
  section: "properties" | "card" | "views" | "people" | "project" = "properties",
) {
  await page.goto(`/p/${projectId}/settings/${section}`);
}

/** A destructive control asks in its own row before it does anything. */
export async function confirmDelete(page: Page, label = /^Yes, /) {
  await page.getByRole("button", { name: label }).click();
}

/** The board column whose header carries this name. */
export function column(page: Page, name: string) {
  return page.getByTestId("column").filter({
    has: page.getByTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });
}

export function card(page: Page, title: string) {
  return page.getByTestId("card").filter({ hasText: title });
}

export async function addTask(page: Page, columnName: string, title: string) {
  await page
    .getByRole("button", { name: `Add a task to ${columnName}` })
    .first()
    .click();
  const input = page.getByPlaceholder("What needs doing?");
  await input.fill(title);
  await input.press("Enter");
  await expect(card(page, title).first()).toBeVisible();
}

/**
 * dnd-kit listens to pointer events and needs real movement, so the drag runs
 * as a sequence of small steps rather than one jump.
 */
export async function dragCard(page: Page, title: string, target: { x: number; y: number }) {
  const source = card(page, title).first();
  const box = await source.boundingBox();
  if (!box) throw new Error(`No card called ${title}`);

  const from = { x: box.x + box.width / 2, y: box.y + 18 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 5 });

  const steps = 22;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((target.x - from.x) * i) / steps,
      from.y + ((target.y - from.y) * i) / steps,
    );
    if (i % 6 === 0) await page.waitForTimeout(24);
  }
  await page.waitForTimeout(140);

  // The board updates the moment the card is dropped, so a test that reloads
  // straight afterwards can outrun the write. Wait for the server to answer.
  await settles(page, /\/api\/tasks\/[0-9a-f-]+\/move$/, () => page.mouse.up());
  await page.waitForTimeout(220);
}

/** Runs `action` and waits for the matching request to come back. */
export async function settles(page: Page, url: RegExp, action: () => Promise<void>) {
  const response = page
    .waitForResponse((r) => url.test(new URL(r.url()).pathname) && r.request().method() !== "GET", {
      timeout: 15_000,
    })
    .catch(() => null);
  await action();
  await response;
}

export async function centreOf(page: Page, columnName: string) {
  const box = await column(page, columnName).boundingBox();
  if (!box) throw new Error(`No column called ${columnName}`);
  return { x: box.x + box.width / 2, y: box.y + 140 };
}

/** The settings card that belongs to one property. */
export function propertyBox(page: Page, propertyName: string) {
  return page.getByTestId("property-box").filter({
    has: page.getByLabel(`Name of the ${propertyName} property`),
  });
}

/** Runs `action` and waits until the value it writes has reached the server. */
export async function saved(page: Page, action: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/(tasks|checklist|comments|options|properties|views)|\/card-view/.test(r.url()) &&
        r.request().method() !== "GET",
    ),
    action(),
  ]);
  expect(response.ok()).toBeTruthy();
}

/**
 * Moves a run back in time.
 *
 * The board closes a run that reports nothing for half an hour, and calls one
 * quiet after six minutes. A test cannot wait that long and must not be able
 * to shorten the rule, because the rule is the thing under test. So it moves
 * the clock the run carries instead, which is what a killed agent looks like
 * from the outside: a row nobody wrote again.
 */
export async function backdateRun(runId: string, minutes: number): Promise<void> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://ushabti:ushabti@localhost:5435/ushabti",
  });
  await client.connect();
  try {
    await client.query(
      `update agent_runs
          set updated_at = now() - ($2 || ' minutes')::interval,
              beat_at    = now() - ($2 || ' minutes')::interval
        where id = $1`,
      [runId, String(minutes)],
    );
  } finally {
    await client.end();
  }
}
