// Films the real app for the promo on the site. It plays one take on a board
// that was just seeded: a person drags a card, gives one to the seeded agent,
// changes a task, a second person moves a card, and the view turns into a
// list. Every frame is a screenshot of the running app; nothing is drawn.
//
//   docker compose exec app npm run db:seed
//   node scripts/promo/film.mjs
//   node scripts/promo/render.mjs
//
// The take runs on a virtual clock. The page's CSS animations are slowed
// down through the DevTools protocol, the pointer and the agent follow the
// same clock, and each screenshot is stamped with the moment it shows. That
// way a slow screenshot never makes the motion jump. The frames and what was
// on screen in each (card boxes, the panel, the pointer) go to
// scripts/promo/out, where render.mjs puts the camera, the words and the
// finish on top.
//
// It reads PROMO_URL, never USHABTI_URL: a shell that points USHABTI_URL at a
// real board must not have this script write to it.
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.PROMO_URL ?? "http://localhost:3050";
const TOKEN = "ush_demo_seed_token_not_for_real_use";
const OWNER = { email: "demo@ushabti.local", password: "ushabti-demo" };
const FRIEND = { email: "friend@ushabti.local", password: "ushabti-demo" };
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const VIEW = { width: 1440, height: 900 };
const SCALE = 2.5; // the camera zooms in up to about 2.4 times
const RATE = 0.08; // how fast the page's own animations run while we film

/* Moments of the take, in seconds of the film. render.mjs reads them back. */
const AT = { board: 0, drag: 3.6, agent: 7.8, props: 15.4, live: 20.6, views: 24.2, end: 29.9 };

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/* ---- the agent's side: plain API calls with the seed's token ---------- */

async function agent(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

let me;
try {
  me = await agent("GET", "/api/agent/me");
} catch (err) {
  console.error(`No seeded board at ${BASE}: ${err.message}`);
  console.error("Run `docker compose exec app npm run db:seed` first.");
  process.exit(1);
}
const projectId = me.project.id;

/* ---- the people's side ------------------------------------------------- */

const browser = await chromium.launch();

async function signIn(who) {
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      // next dev draws its badge in a corner; the film is of the board.
      style.textContent =
        "nextjs-portal { display: none !important; } ::-webkit-scrollbar { display: none; }";
      document.head.append(style);
    });
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(who.email);
  await page.getByLabel("Your password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/projects");
  return { context, page };
}

async function send(request, method, path, data) {
  const res = await request.fetch(BASE + path, { method, data });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const owner = await signIn(OWNER);
const req = owner.context.request;

let board = await send(req, "GET", `/api/projects/${projectId}/board`);
if (board.properties.some((p) => p.name === "Phase")) {
  console.error("This board was filmed already. Seed it again before a new take.");
  process.exit(1);
}
if (board.runs.some((r) => r.taskId === board.tasks.find((t) => t.key === "USH-6")?.id)) {
  console.error("USH-6 already has a run. Seed the board again before a new take.");
  process.exit(1);
}

/* ---- dress the board the way a team that uses it would ---------------- */

const prop = (name) => board.properties.find((p) => p.name === name);
const task = (key) => board.tasks.find((t) => t.key === key);
const option = (p, name) => p.options.find((o) => o.name === name);

async function makeProperty(name, type, options) {
  const { property } = await send(req, "POST", `/api/projects/${projectId}/properties`, {
    name,
    type,
    options: options?.map((o) => o.name),
  });
  for (const o of options ?? []) {
    const made = property.options.find((x) => x.name === o.name);
    await send(req, "PATCH", `/api/options/${made.id}`, {
      color: o.color,
      ...(o.icon ? { icon: o.icon } : {}),
    });
  }
  return property;
}

await makeProperty("Phase", "select", [
  { name: "PoC", color: "#8b8f98" },
  { name: "MVP", color: "#3fb0c8" },
  { name: "MMP", color: "#6d5bd0" },
  { name: "Pilot", color: "#d1913a" },
  { name: "GA", color: "#4f8a5b" },
]);
await makeProperty("Area", "multi_select", [
  { name: "app", color: "#4b8fbe", icon: "Monitor" },
  { name: "api", color: "#e0574d", icon: "Database" },
  { name: "agents", color: "#3fb0c8", icon: "Cpu" },
  { name: "mobile", color: "#2f9e7a", icon: "Smartphone" },
  { name: "docs", color: "#c9925a", icon: "BookOpen" },
  { name: "design", color: "#6d5bd0", icon: "Image" },
]);
const refined = await makeProperty("Refined", "checkbox");

const DRESS = {
  "USH-1": { phase: "PoC", area: ["app", "api"], refined: true },
  "USH-2": { phase: "MVP", area: ["app"], refined: true },
  "USH-3": { phase: "MVP", area: ["app", "design"], refined: true },
  "USH-4": { phase: "MVP", area: ["api", "app"], refined: true },
  "USH-5": { phase: "MMP", area: ["api", "docs"] },
  "USH-6": { phase: "MMP", area: ["app", "agents"], refined: true },
  "USH-7": { phase: "MMP", area: ["app", "design"] },
  "USH-8": { phase: "Pilot", area: ["api", "docs"] },
  "USH-9": { phase: "GA", area: ["app", "mobile"] },
};
board = await send(req, "GET", `/api/projects/${projectId}/board`);
for (const [key, d] of Object.entries(DRESS)) {
  const t = task(key);
  const ph = prop("Phase"),
    ar = prop("Area");
  await send(req, "PUT", `/api/tasks/${t.id}/values/${ph.id}`, { value: option(ph, d.phase).id });
  await send(req, "PUT", `/api/tasks/${t.id}/values/${ar.id}`, {
    value: d.area.map((n) => option(ar, n).id),
  });
  if (d.refined) await send(req, "PUT", `/api/tasks/${t.id}/values/${refined.id}`, { value: true });
}

/* The card a team arranges once they live on the board: priority as the
   edge, a tick for refined work, phase as a filled chip, the areas as icons. */
const rows = { ...board.cardView.rows };
rows[prop("Priority").id] = { place: "edge", mode: "colour" };
rows[prop("Labels").id] = { place: "body", mode: "both" };
rows[prop("Refined").id] = { place: "headerR", mode: "icon" };
rows[prop("Phase").id] = { place: "footerL", mode: "fill" };
rows[prop("Area").id] = { place: "footerL", mode: "colour" };
rows[prop("Estimate").id] = { place: "footerL", mode: "text" };
rows._checklist = { place: "footerR", mode: "bar" };
rows._comments = { place: "footerR", mode: "text" };
await send(req, "PATCH", `/api/projects/${projectId}/card-view`, { cardView: { rows } });

/* More projects, so the sidebar looks like somebody's. */
const { projects: mine } = await send(req, "GET", "/api/projects");
for (const p of [
  { name: "Ushabti site", key: "WEB" },
  { name: "Mobile app", key: "MOB" },
  { name: "Docs", key: "DOC" },
]) {
  if (!mine.some((x) => x.key === p.key)) await send(req, "POST", "/api/projects", p);
}

board = await send(req, "GET", `/api/projects/${projectId}/board`);
const status = prop("Status");

/* ---- the take ---------------------------------------------------------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "frames"), { recursive: true });

const page = owner.page;
await page.goto(`${BASE}/p/${projectId}`);
await page.getByTestId("card").filter({ visible: true }).first().waitFor();
await page.mouse.move(980, 700);
await page.waitForTimeout(1500);

const friend = await signIn(FRIEND);

const cdp = await owner.context.newCDPSession(page);
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: RATE });

const card = (title) => page.getByTestId("card").filter({ hasText: title, visible: true });
const center = async (locator) => {
  const b = await locator.first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/* The pointer: where it is, where it goes, and whether the button is down. */
const ptr = { x: 980, y: 700, down: false, from: null, to: null, t0: 0, t1: 0 };
const clicks = [];
const marks = {};
async function glide(v, dur, to) {
  ptr.from = { x: ptr.x, y: ptr.y };
  ptr.to = typeof to === "function" ? await to() : to;
  ptr.t0 = v;
  ptr.t1 = v + dur;
}
async function press(v) {
  await page.mouse.down();
  ptr.down = true;
  clicks.push({ v, x: ptr.x, y: ptr.y });
}
async function release() {
  await page.mouse.up();
  ptr.down = false;
}
async function click(v) {
  await press(v);
  await release();
}

/* A scroll of the panel, spread over a stretch of the clock. */
const roll = { from: 0, to: 0, by: 0, done: 0 };
let run;
const STEPS = [
  "Read the filter rules",
  "Draft the sort button",
  "Write the list tests",
  "Run the suite",
  "Open a pull request",
];
const usher6 = task("USH-6");

/* What happens, and when. Each beat runs once, when the clock passes it. */
const beats = [
  // Drag: USH-5 from Todo to the top of In Progress.
  [AT.drag + 0.2, (v) => glide(v, 0.85, () => center(card("Invite a friend by email")))],
  [AT.drag + 1.1, (v) => press(v)],
  [
    AT.drag + 1.15,
    (v) =>
      glide(v, 1.6, async () => {
        const c = await center(card("Drag and drop that feels right"));
        return { x: c.x, y: c.y - 30 };
      }),
  ],
  [AT.drag + 2.95, () => release()],
  [AT.drag + 3.2, (v) => glide(v, 0.7, { x: 900, y: 640 })],

  // Agent: the person gives USH-6 to Builder, and Builder takes it.
  [AT.agent + 0.1, (v) => glide(v, 0.6, () => center(card("Filter and sort inside a view")))],
  [AT.agent + 0.8, (v) => click(v)],
  [
    AT.agent + 1.3,
    (v) =>
      glide(v, 0.5, () =>
        center(page.getByTestId("task-panel").getByRole("button", { name: /Demo Owner/ })),
      ),
  ],
  [AT.agent + 1.85, (v) => click(v)],
  [
    AT.agent + 2.15,
    (v) =>
      glide(v, 0.4, () =>
        center(
          page
            .getByRole("button", { name: me.agent.name, exact: true })
            .or(page.getByRole("option", { name: me.agent.name })),
        ),
      ),
  ],
  [AT.agent + 2.6, (v) => click(v)],
  [
    AT.agent + 2.9,
    async (v) => {
      ({ run } = await agent("POST", `/api/tasks/${usher6.id}/run`, {
        goal: "Filter and sort inside a view",
        step: STEPS[0],
        steps: STEPS,
      }));
      await agent("PUT", `/api/tasks/${usher6.id}/values/${status.id}`, {
        value: option(status, "In Progress").id,
      });
      marks.took = v;
    },
  ],
  [AT.agent + 3.2, (v) => glide(v, 0.5, () => center(page.getByTestId("agent-tab")))],
  [AT.agent + 3.75, (v) => click(v)],
  [AT.agent + 4.0, (v) => glide(v, 0.5, { x: 1250, y: 760 })],
  [
    AT.agent + 4.5,
    (v) => {
      roll.from = v;
      roll.to = v + 0.7;
      roll.by = 420;
      roll.done = 0;
    },
  ],
  ...[1, 2, 3, 4].map((i) => [
    AT.agent + 3.9 + i * 0.65,
    () =>
      agent("PATCH", `/api/runs/${run.id}`, {
        step: STEPS[i],
        stepIndex: i,
        log: `step ${i + 1}: ${STEPS[i].toLowerCase()}`,
      }),
  ]),
  [AT.agent + 6.9, (v) => glide(v, 0.5, { x: 820, y: 700 })],
  [AT.agent + 7.25, () => page.keyboard.press("Escape")],

  // Properties: USH-3 changes priority and estimate in the panel.
  [AT.props + 0.05, (v) => glide(v, 0.4, () => center(card("Drag and drop that feels right")))],
  [
    AT.props + 0.5,
    (v) => {
      marks.props = v;
      return click(v);
    },
  ],
  [
    AT.props + 1.05,
    (v) =>
      glide(v, 0.5, () =>
        center(page.getByTestId("task-panel").getByRole("button", { name: "High", exact: true })),
      ),
  ],
  [AT.props + 1.6, (v) => click(v)],
  [
    AT.props + 2.0,
    (v) =>
      glide(v, 0.5, () =>
        center(page.getByTestId("task-panel").getByRole("button", { name: "L", exact: true })),
      ),
  ],
  [AT.props + 2.55, (v) => click(v)],
  [
    AT.props + 3.7,
    (v) =>
      glide(v, 0.5, () =>
        center(page.getByTestId("task-panel").getByRole("button", { name: "Close task" })),
      ),
  ],
  [AT.props + 4.25, (v) => click(v)],
  [AT.props + 4.5, (v) => glide(v, 0.6, { x: 700, y: 760 })],

  // Live: a second person moves USH-9 to Todo from their own screen.
  [AT.live + 0.1, () => friend.page.goto(`${BASE}/p/${projectId}`)],
  [
    AT.live + 1.4,
    async (v) => {
      await send(
        friend.context.request,
        "PUT",
        `/api/tasks/${task("USH-9").id}/values/${status.id}`,
        { value: option(status, "Todo").id },
      );
      marks.live = v;
    },
  ],

  // Views: the same tasks as a list.
  [AT.views + 0.1, (v) => glide(v, 0.55, () => center(page.getByText("List", { exact: true })))],
  [
    AT.views + 0.7,
    async (v) => {
      marks.list = v;
      await click(v);
    },
  ],
  [AT.views + 1.0, (v) => glide(v, 0.8, { x: 720, y: 640 })],
];

const frames = [];
const t0 = Date.now();
let next = 0;
let n = 0;
for (;;) {
  const v = ((Date.now() - t0) / 1000) * RATE;
  if (v > AT.end) break;
  while (next < beats.length && beats[next][0] <= v) {
    await beats[next][1](v);
    next += 1;
  }
  if (ptr.to) {
    const p = Math.min(1, Math.max(0, (v - ptr.t0) / Math.max(0.001, ptr.t1 - ptr.t0)));
    ptr.x = ptr.from.x + (ptr.to.x - ptr.from.x) * ease(p);
    ptr.y = ptr.from.y + (ptr.to.y - ptr.from.y) * ease(p);
    await page.mouse.move(ptr.x, ptr.y);
  }
  if (roll.to > roll.from && roll.done < roll.by) {
    const p = Math.min(1, Math.max(0, (v - roll.from) / (roll.to - roll.from)));
    const step = Math.round(roll.by * ease(p)) - roll.done;
    if (step > 0) {
      await page.mouse.wheel(0, step);
      roll.done += step;
    }
  }
  const shotAt = ((Date.now() - t0) / 1000) * RATE;
  const seen = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    const cards = {};
    for (const el of document.querySelectorAll('[data-testid="card"]')) {
      if (!el.checkVisibility()) continue;
      const key = (el.textContent.match(/USH-\d+/) || [])[0];
      if (key) cards[key] = box(el);
    }
    const panel = document.querySelector('[data-testid="task-panel"]');
    return { cards, panel: panel && panel.checkVisibility() ? box(panel) : null };
  });
  const file = `f${String(n).padStart(5, "0")}.jpg`;
  await page.screenshot({ path: join(OUT, "frames", file), type: "jpeg", quality: 92 });
  frames.push({
    v: +shotAt.toFixed(4),
    file,
    ptr: { x: Math.round(ptr.x), y: Math.round(ptr.y), down: ptr.down },
    ...seen,
  });
  n += 1;
  if (n % 50 === 0) console.log(`${n} frames, ${shotAt.toFixed(1)} s of ${AT.end}`);
}

await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
writeFileSync(
  join(OUT, "take.json"),
  JSON.stringify({ at: AT, view: VIEW, scale: SCALE, marks, clicks, frames }),
);
await browser.close();
console.log(`Filmed ${frames.length} frames into ${OUT}`);
