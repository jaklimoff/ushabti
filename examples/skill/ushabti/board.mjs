#!/usr/bin/env node
/**
 * The Ushabti board, as commands. Every call an agent needs, with the property
 * and option lookups done for it, so nothing has to hardcode an id.
 *
 *   USHABTI_TOKEN=ush_…  node board.mjs <command> [options]
 *
 * `node board.mjs help` prints the list.
 */

const BASE = (process.env.USHABTI_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.USHABTI_TOKEN;

/* ------------------------------------------------------------------ */
/* The wire                                                            */
/* ------------------------------------------------------------------ */

async function call(method, path, payload) {
  if (!TOKEN) fail("Set USHABTI_TOKEN. The owner issues one in Settings -> People, with Connect.");
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 409) fail(`409: ${data?.error ?? "conflict"}`, 9);
    fail(`${res.status}: ${data?.error ?? text}`);
  }
  return data;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const positional = [];
const flags = {};

for (let i = 1; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg.startsWith("--")) {
    const name = arg.slice(2);
    const value = argv[i + 1]?.startsWith("--") === false ? argv[(i += 1)] : "true";
    if (flags[name] === undefined) flags[name] = value;
    else flags[name] = [].concat(flags[name], value);
  } else {
    positional.push(arg);
  }
}

/* ------------------------------------------------------------------ */
/* Reading the board                                                   */
/* ------------------------------------------------------------------ */

let cache = null;

async function board() {
  if (cache) return cache;
  const me = await call("GET", "/api/agent/me");
  const data = await call("GET", `/api/projects/${me.project.id}/board`);
  cache = { me, ...data };
  return cache;
}

/** A task by its key (USH-14, or just 14) or by its id. */
function findTask(data, wanted) {
  const term = String(wanted ?? "").trim();
  if (!term) fail("Name a task, by key (USH-14) or by id.");
  const key = /^\d+$/.test(term) ? `${data.project.key}-${term}` : term.toUpperCase();
  const task = data.tasks.find((t) => t.key.toUpperCase() === key || t.id === term);
  if (!task) fail(`No task ${term} on this board.`);
  return task;
}

function findProperty(data, wanted) {
  const term = String(wanted ?? "")
    .trim()
    .toLowerCase();
  const property = data.properties.find((p) => p.name.toLowerCase() === term);
  if (!property) {
    fail(
      `No property called "${wanted}". This board has: ${data.properties.map(nameOf).join(", ")}`,
    );
  }
  return property;
}

const nameOf = (row) => row.name;

/**
 * Turns what a person would write into what the API stores. This is the reason
 * the file exists: the ids belong to the board, not to the agent.
 */
function coerce(data, property, raw) {
  const text = String(raw ?? "").trim();
  if (text === "" || text.toLowerCase() === "none") {
    return property.type === "multi_select" ? [] : null;
  }

  switch (property.type) {
    case "select":
      return optionId(property, text);
    case "multi_select":
      return text.split(",").map((part) => optionId(property, part.trim()));
    case "person": {
      const member = data.members.find(
        (m) => m.name.toLowerCase() === text.toLowerCase() || m.id === text,
      );
      if (!member)
        fail(`No member called "${text}". Members: ${data.members.map(nameOf).join(", ")}`);
      return member.id;
    }
    case "checkbox":
      return ["true", "yes", "on", "1"].includes(text.toLowerCase());
    case "number":
      return Number(text);
    default:
      return text;
  }
}

function optionId(property, wanted) {
  const option = property.options.find((o) => o.name.toLowerCase() === wanted.toLowerCase());
  if (!option) {
    fail(
      `"${wanted}" is not an option of ${property.name}. ` +
        `It has: ${property.options.map(nameOf).join(", ")}`,
    );
  }
  return option.id;
}

/* ------------------------------------------------------------------ */
/* Printing                                                            */
/* ------------------------------------------------------------------ */

function valueText(data, property, value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return "";
  if (property.type === "select") return property.options.find((o) => o.id === value)?.name ?? "?";
  if (property.type === "multi_select")
    return value.map((id) => property.options.find((o) => o.id === id)?.name ?? "?").join(",");
  if (property.type === "person") return data.members.find((m) => m.id === value)?.name ?? "?";
  if (property.type === "checkbox") return value ? property.name : "";
  return String(value);
}

function taskLine(data, task) {
  const run = data.runs.find((r) => r.taskId === task.id);
  const bits = data.properties
    .filter((p) => p.type !== "text")
    .map((p) => valueText(data, p, task.values[p.id]))
    .filter(Boolean);
  const held = run ? `  <- ${run.agent.name}: ${run.step || run.goal || "working"}` : "";
  return `  ${task.key.padEnd(8)} ${task.title}${bits.length ? `   [${bits.join(" · ")}]` : ""}${held}`;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

const commands = {
  async help() {
    console.log(`Ushabti board — ${BASE}

  me                                  who am I, which board
  props                               every property and its options
  list [--held] [--free]              the board, grouped by the main view
  task <key>                          one task in full
  new "<title>" [--set "Name=Value"]  create a task
  set <key> "<Property>" "<Value>"    set one property (names, not ids)
  comment <key> "<text>"              leave a note
  claim <key> --goal "<what>" [--plan "a|b|c"] [--step "<now>"]
  step <key> --say "<now>" [--index 2] [--log "<line>"]
  finish <key> [--status done|failed] [--log "<line>"]

Every command needs USHABTI_TOKEN. Set USHABTI_URL if the board is not at
http://localhost:3000.`);
  },

  async me() {
    const data = await board();
    console.log(`${data.me.agent.name} on ${data.project.name} (${data.project.key}) at ${BASE}`);
    console.log(`${data.tasks.length} tasks, ${data.runs.length} open runs`);
  },

  async props() {
    const data = await board();
    for (const p of data.properties) {
      const options = p.options.length ? `: ${p.options.map(nameOf).join(" | ")}` : "";
      console.log(`${p.name} (${p.type})${options}`);
    }
    console.log(`Members: ${data.members.map(nameOf).join(", ")}`);
  },

  async list() {
    const data = await board();
    const view = data.views.find((v) => v.isDefault) ?? data.views[0];
    const group = data.properties.find((p) => p.id === view?.groupById) ?? null;
    const held = new Set(data.runs.map((r) => r.taskId));

    let tasks = data.tasks;
    if (flags.held) tasks = tasks.filter((t) => held.has(t.id));
    if (flags.free) tasks = tasks.filter((t) => !held.has(t.id));

    if (!group) {
      for (const task of tasks) console.log(taskLine(data, task));
      return;
    }

    for (const option of [...group.options, { id: null, name: `No ${group.name}` }]) {
      const inColumn = tasks.filter((t) => (t.values[group.id] ?? null) === option.id);
      if (!inColumn.length) continue;
      console.log(`${option.name.toUpperCase()} (${inColumn.length})`);
      for (const task of inColumn) console.log(taskLine(data, task));
    }
  },

  async task() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const detail = (await call("GET", `/api/tasks/${task.id}`)).task;

    console.log(`${task.key}  ${detail.title}`);
    for (const p of data.properties) {
      const text = valueText(data, p, detail.values[p.id]);
      if (text) console.log(`  ${p.name}: ${text}`);
    }
    if (detail.description.trim()) console.log(`\n${detail.description.trim()}\n`);
    for (const item of detail.checklist) console.log(`  [${item.done ? "x" : " "}] ${item.text}`);
    for (const c of detail.comments) console.log(`  ${c.author?.name ?? "?"}: ${c.body}`);
    if (detail.run) {
      console.log(`  run ${detail.run.id} — ${detail.run.agent.name}, ${detail.run.status}`);
      for (const s of detail.run.steps)
        console.log(`    ${s.state === "done" ? "x" : "-"} ${s.text}`);
    }
  },

  async new() {
    const data = await board();
    const title = positional[0];
    if (!title) fail('Give a title: new "Fix the queue"');

    const values = {};
    for (const pair of [].concat(flags.set ?? [])) {
      const [name, ...rest] = String(pair).split("=");
      const property = findProperty(data, name);
      values[property.id] = coerce(data, property, rest.join("="));
    }

    const { task } = await call("POST", `/api/projects/${data.project.id}/tasks`, {
      title,
      values,
    });
    console.log(`${task.key} created`);
  },

  async set() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const property = findProperty(data, positional[1]);
    const value = coerce(data, property, positional[2]);
    await call("PUT", `/api/tasks/${task.id}/values/${property.id}`, { value });
    console.log(`${task.key}: ${property.name} = ${valueText(data, property, value) || "empty"}`);
  },

  async comment() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const body = positional[1];
    if (!body) fail('Give the text: comment USH-14 "the tests pass"');
    await call("POST", `/api/tasks/${task.id}/comments`, { body });
    console.log(`${task.key}: comment left`);
  },

  async claim() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const steps = flags.plan
      ? String(flags.plan)
          .split("|")
          .map((s) => s.trim())
      : [];
    const { run } = await call("POST", `/api/tasks/${task.id}/run`, {
      goal: flags.goal ?? `Work on ${task.key}`,
      step: flags.step ?? steps[0] ?? "",
      steps,
    });
    console.log(`${task.key} claimed. run ${run.id}`);
  },

  async step() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const run = data.runs.find((r) => r.taskId === task.id);
    // Exit 9 is the answer the server gives too: the card is not yours.
    if (!run) fail(`No open run on ${task.key}. It was taken over, or never claimed.`, 9);

    const patch = {};
    if (flags.say) patch.step = flags.say;
    if (flags.log) patch.log = flags.log;
    if (flags.index !== undefined) patch.stepIndex = Number(flags.index);
    if (flags.plan)
      patch.steps = String(flags.plan)
        .split("|")
        .map((s) => s.trim());

    const answer = await call("PATCH", `/api/runs/${run.id}`, patch);
    console.log(`control: ${answer.control ?? "none"}`);
  },

  async finish() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const run = data.runs.find((r) => r.taskId === task.id);
    if (!run) fail(`No open run on ${task.key}. Somebody took it over.`, 9);
    const status = flags.status ?? "done";
    await call("PATCH", `/api/runs/${run.id}`, { status, log: flags.log ?? status });
    console.log(`${task.key}: run ${status}`);
  },
};

const run = commands[command];
if (!run) fail(`No command "${command}". Try: node board.mjs help`);
await run();
