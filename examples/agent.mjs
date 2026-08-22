/**
 * A small agent, with no dependencies. It claims a task, reports what it is
 * doing, obeys Pause and Stop from the board, and closes its run.
 *
 *   npm run db:seed
 *   USHABTI_TOKEN=ush_demo_seed_token_not_for_real_use node examples/agent.mjs
 *
 * Read it, then write your own. The real work goes where `pretendToWork` is.
 */

const BASE = process.env.USHABTI_URL ?? "http://localhost:3000";
const TOKEN = process.env.USHABTI_TOKEN;

if (!TOKEN) {
  console.error("Set USHABTI_TOKEN. Settings -> Agents -> Issue token.");
  process.exit(1);
}

async function call(method, path, payload) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- who am I, and where ------------------------------------------- */

const me = await call("GET", "/api/agent/me");
console.log(`I am ${me.agent.name} on ${me.project.name} (${me.project.key}).`);

const board = await call("GET", `/api/projects/${me.project.id}/board`);

/* ---- nothing is hardcoded: find the property, then the option ------- */

const status = board.properties.find((p) => p.name.toLowerCase() === "status");
if (!status) throw new Error("This board has no property called Status. Pick another one.");

const inProgress = status.options.find((o) => /progress/i.test(o.name)) ?? status.options[1];

/* ---- pick a task nobody else is working on -------------------------- */

const held = new Set(board.runs.map((r) => r.taskId));
const task = board.tasks.find((t) => !held.has(t.id));
if (!task) {
  console.log("Every task already has a run on it. Nothing to do.");
  process.exit(0);
}

console.log(`Taking ${task.key}: ${task.title}`);

/* ---- open the run with a plan --------------------------------------- */

const plan = [
  "Read the task and its checklist",
  "Draft the change",
  "Run the tests",
  "Report back",
];

const { run } = await call("POST", `/api/tasks/${task.id}/run`, {
  goal: `Work on ${task.key}`,
  step: plan[0],
  steps: plan,
});

await call("PUT", `/api/tasks/${task.id}/values/${status.id}`, { value: inProgress.id });

/* ---- the loop -------------------------------------------------------- */

let paused = false;

for (let index = 0; index < plan.length; index += 1) {
  await pretendToWork();

  let answer;
  try {
    answer = await call("PATCH", `/api/runs/${run.id}`, {
      step: plan[index],
      stepIndex: index,
      log: `step ${index + 1}: ${plan[index].toLowerCase()}`,
      ...(paused ? { status: "running" } : {}),
    });
  } catch (err) {
    // 409 means the run is closed under us: a person took the card over.
    if (err.status === 409) {
      console.log("A person took the card over. Stopping.");
      process.exit(0);
    }
    throw err;
  }
  paused = false;

  // The board asked for something. Nothing forces us; we answer because we
  // said we would.
  if (answer.control === "stop") {
    await call("PATCH", `/api/runs/${run.id}`, { status: "stopped", log: "stopped on request" });
    console.log("A person asked me to stop. Run closed.");
    process.exit(0);
  }

  if (answer.control === "pause") {
    await call("PATCH", `/api/runs/${run.id}`, { status: "paused", log: "paused on request" });
    console.log("Paused. Waiting for Resume on the board.");
    paused = true;
    while (paused) {
      await wait(2000);
      const { run: fresh } = await call("GET", `/api/runs/${run.id}`);
      if (fresh.control === "resume") paused = false;
      if (fresh.control === "stop" || fresh.endedAt) process.exit(0);
    }
  }
}

await call("POST", `/api/tasks/${task.id}/comments`, {
  body: `I walked the plan on ${task.key}. Nothing here is real work yet.`,
});

await call("PATCH", `/api/runs/${run.id}`, { status: "done", log: "finished" });
console.log("Done. The card is quiet again.");

/**
 * Where your agent does the real thing: call a model, edit a file, run a test.
 * Here it only waits, so the board has time to show the run.
 */
async function pretendToWork() {
  await wait(3000);
}
