// Records docs/demo.gif, the clip at the top of the README, and takes
// docs/board.png and the site's copy again. USHABTI_STILL_ONLY=1 takes only
// the still. Run it against a board that was just seeded:
//
//   docker compose exec app npm run db:seed
//   node scripts/record-demo.mjs
//
// One take: a person gives a card to the seeded agent, the agent opens a run
// and walks its plan, the person presses Pause, the agent says it paused, and
// Take over gives the card back. This script plays both sides. The person is a
// Playwright browser; the agent is a few fetch calls with the seed's token,
// the same calls examples/agent.mjs makes.
//
// It is not a test and no test run or CI job calls it. Playwright records a
// webm, and ffmpeg, a tool of the recording machine, turns it into the gif.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.USHABTI_URL ?? "http://localhost:3050";
const TOKEN = process.env.USHABTI_TOKEN ?? "ush_demo_seed_token_not_for_real_use";
const PERSON = { email: "demo@ushabti.local", password: "ushabti-demo" };
const CARD = "Filter and sort inside a view";
const GIF = "docs/demo.gif";
const BOARD = "docs/board.png";
const SITE_BOARD = "website/src/assets/board.png";
/* A second project of the person's own, so the still shows the sidebar. */
const SECOND = { name: "Ushabti site", key: "WEB" };
// A README that opens on a heavy gif opens slowly.
const MAX_BYTES = 8 * 1024 * 1024;
const SIZE = { width: 1280, height: 720 };

try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg is not on this machine. Install it (brew install ffmpeg) and run again.");
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, payload) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(`${method} ${path} -> ${res.status}: ${data?.error ?? text}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

let me;
try {
  me = await call("GET", "/api/agent/me");
} catch (err) {
  console.error(`No seeded board at ${BASE}: ${err.message}`);
  console.error("Run `npm run db:seed` first, or set USHABTI_URL.");
  process.exit(1);
}
const board = await call("GET", `/api/projects/${me.project.id}/board`);
const task = board.tasks.find((t) => t.title === CARD);
if (!task) {
  console.error(`The board has no card "${CARD}". Seed it again.`);
  process.exit(1);
}
if (board.runs.some((r) => r.taskId === task.id)) {
  console.error(`"${CARD}" already has a run. Seed the board again before a new take.`);
  process.exit(1);
}
const status = board.properties.find((p) => p.name === "Status");
const inProgress = status.options.find((o) => o.name === "In Progress");

const work = mkdtempSync(join(tmpdir(), "ushabti-demo-"));
const browser = await chromium.launch();
const boardUrl = `${BASE}/p/${me.project.id}`;

/* ---- sign in once, outside the recording ------------------------------ */

const login = await browser.newContext({ viewport: SIZE, colorScheme: "dark" });
const signIn = await login.newPage();
await signIn.goto(`${BASE}/login`);
await signIn.getByPlaceholder("you@example.com").fill(PERSON.email);
await signIn.getByLabel("Your password").fill(PERSON.password);
await signIn.getByRole("button", { name: "Sign in" }).click();
await signIn.waitForURL("**/projects");
const { projects: mine } = await (await login.request.get(`${BASE}/api/projects`)).json();
if (!mine.some((p) => p.key === SECOND.key)) {
  const made = await login.request.post(`${BASE}/api/projects`, { data: SECOND });
  if (!made.ok()) throw new Error(`Could not make ${SECOND.name}: ${made.status()}`);
}
const session = await login.storageState();
await login.close();

/* ---- the still: the board as the seed makes it ------------------------ */

const still = await browser.newContext({
  viewport: { width: 1440, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  storageState: session,
});
await still.addInitScript(hideDevBadge);
const stillPage = await still.newPage();
await stillPage.goto(boardUrl);
await stillPage.getByTestId("card-run").first().waitFor();
await stillPage.waitForTimeout(1000);
await stillPage.screenshot({ path: BOARD });
await still.close();
copyFileSync(BOARD, SITE_BOARD);
console.log(`Wrote ${BOARD} and ${SITE_BOARD}`);
if (process.env.USHABTI_STILL_ONLY) {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

/* ---- the take ---------------------------------------------------------- */

const context = await browser.newContext({
  viewport: SIZE,
  colorScheme: "dark",
  storageState: session,
  recordVideo: { dir: work, size: SIZE },
});
await context.addInitScript(hideDevBadge);
await context.addInitScript(drawPointer);
const opened = Date.now();
const page = await context.newPage();
await page.goto(boardUrl);
const held = page.getByTestId("card").filter({ hasText: CARD });
await held.waitFor();
await page.mouse.move(640, 600);
await page.waitForTimeout(800);
// The clip starts here: everything before is a blank page loading.
const start = (Date.now() - opened) / 1000;

await glide(page, held);
await held.click();
const panel = page.getByTestId("task-panel");
await panel.waitFor();
await page.waitForTimeout(900);

const assignee = panel.getByRole("button", { name: /Demo Owner/ });
await glide(page, assignee);
await assignee.click();
await page.waitForTimeout(500);
const builder = page
  .getByRole("button", { name: me.agent.name, exact: true })
  .or(page.getByRole("option", { name: me.agent.name }));
await glide(page, builder.first());
await builder.first().click();
await page.waitForTimeout(700);

// The agent hears its name and takes the card.
const agent = runAgent();
await held.getByTestId("card-run").waitFor();
await page.waitForTimeout(1200);

const tab = page.getByTestId("agent-tab");
await glide(page, tab);
await tab.click();
const run = page.getByTestId("panel-run");
await run.waitFor();
await page.waitForTimeout(5000);

const pause = run.getByRole("button", { name: "Pause" });
await glide(page, pause);
await pause.click();
await held.getByTestId("card-run-step").filter({ hasText: "Paused" }).waitFor();
await page.waitForTimeout(2000);

const takeOver = run.getByRole("button", { name: "Take over" });
await glide(page, takeOver);
await takeOver.click();
await run.waitFor({ state: "hidden" });
await held.getByTestId("card-run").waitFor({ state: "hidden" });
await page.waitForTimeout(2000);
const end = (Date.now() - opened) / 1000;

await agent;
const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

/* ---- the gif ----------------------------------------------------------- */

// Two passes with one palette made from the clip itself, so the dark board
// keeps its greys and the gif stays small.
const scale = "fps=12,scale=960:-1:flags=lanczos";
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    start.toFixed(2),
    "-to",
    end.toFixed(2),
    "-i",
    webm,
    "-filter_complex",
    `${scale},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    GIF,
  ],
  { stdio: "inherit" },
);
rmSync(work, { recursive: true, force: true });

const bytes = statSync(GIF).size;
const seconds = end - start;
console.log(`Wrote ${GIF}: ${seconds.toFixed(1)} s, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (seconds >= 30 || bytes >= MAX_BYTES) {
  console.error("The clip has to stay under 30 seconds and 8 MB.");
  process.exit(1);
}

/* ---- the agent's side --------------------------------------------------- */

/**
 * Opens a run on the card, reports one step of its plan every two seconds,
 * answers Pause as examples/agent.mjs does, and stops when a person takes the
 * card over.
 */
async function runAgent() {
  const plan = [
    "Read the filter rules",
    "Draft the sort button",
    "Write the list tests",
    "Run the suite",
    "Open a pull request",
  ];
  const { run } = await call("POST", `/api/tasks/${task.id}/run`, {
    goal: "Filter and sort inside a view",
    step: plan[0],
    steps: plan,
  });
  await call("PUT", `/api/tasks/${task.id}/values/${status.id}`, { value: inProgress.id });

  // It walks to the step before the last and stays there, beating, so Pause
  // always finds it at work however slow the browser was. A beat reads the
  // control word and writes no step, so the log says each step once.
  for (let index = 1; index < plan.length - 1; index += 1) {
    await wait(2000);
    await call("PATCH", `/api/runs/${run.id}`, {
      step: plan[index],
      stepIndex: index,
      log: `step ${index + 1}: ${plan[index].toLowerCase()}`,
    });
  }
  for (let paused = false; ;) {
    await wait(500);
    let answer;
    try {
      answer = await call("PATCH", `/api/runs/${run.id}`, { beat: true });
    } catch (err) {
      // 409: a person took the card over and the run is closed.
      if (err.status === 409) return;
      throw err;
    }
    if (answer.control === "pause" && !paused) {
      await call("PATCH", `/api/runs/${run.id}`, {
        status: "paused",
        step: "Paused",
        log: "paused on request",
      });
      paused = true;
    }
  }
}

/* ---- what the browser is given ----------------------------------------- */

/** Moves the pointer to a thing in steps, so the clip shows where it goes. */
async function glide(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
  await page.waitForTimeout(250);
}

/** `next dev` draws its badge in a corner; the clip is of the board. */
function hideDevBadge() {
  const style = document.createElement("style");
  style.textContent = "nextjs-portal { display: none !important; }";
  document.addEventListener("DOMContentLoaded", () => document.head.append(style));
}

/** A recorded browser draws no pointer, so the page draws one of its own. */
function drawPointer() {
  document.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;" +
      "background:rgba(255,255,255,.85);box-shadow:0 0 0 2px rgba(0,0,0,.5);pointer-events:none;" +
      "z-index:2147483647;transition:transform .12s;";
    document.body.append(dot);
    document.addEventListener("mousemove", (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    });
    document.addEventListener("mousedown", () => (dot.style.transform = "scale(.7)"));
    document.addEventListener("mouseup", () => (dot.style.transform = ""));
  });
}
