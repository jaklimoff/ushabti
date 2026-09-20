#!/usr/bin/env node
/**
 * The Ushabti board, as commands. Every call an agent needs, with the property
 * and option lookups done for it, so nothing has to hardcode an id.
 *
 *   USHABTI_TOKEN=ush_…  node board.mjs <command> [options]
 *
 * `node board.mjs help` prints the list.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.USHABTI_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.USHABTI_TOKEN;
const SKILL_DIR = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* The wire                                                            */
/* ------------------------------------------------------------------ */

/**
 * One call. It throws on a bad answer, with the status on the error, so that
 * the watcher can live through one. A command uses `call`, which exits.
 */
async function request(method, path, payload) {
  if (!TOKEN) fail("Set USHABTI_TOKEN. The owner issues one in Settings -> People, with Connect.");
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error(`${res.status}: ${data?.error ?? text}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function call(method, path, payload) {
  try {
    return await request(method, path, payload);
  } catch (err) {
    if (err.status === 409) fail(err.message, 9);
    fail(err.status ? err.message : `The board at ${BASE} did not answer: ${err.message}`);
  }
}

/**
 * The same call, for the heartbeat, which must not die on the first bad
 * answer. A board that cannot be reached for a minute is not a reason to give
 * up: the lease on the server is there for the case where this never recovers.
 * Status 0 means the request itself failed.
 */
async function trySend(method, path, payload) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return res.status;
  } catch {
    return 0;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

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
  beat <key> [--every 120] [--for 60]  say "still here" until the session ends
  step <key> --say "<now>" [--index 2] [--log "<line>"]
  check <key> "<item>"                add a checklist item
  describe <key> "<markdown>"         write the description, if it is empty or yours
  ask <key> "<question>"              ask a person, wait, and end your session
  pause <key> [--for 5]               answer a Pause: stop, wait for Resume, go on
  finish <key> [--status done|failed] [--log "<line>"]

  watch --run "<command>" [--on assigned,mention,created] [--goal "<job>"]
        [--jobs 1] [--timeout 30] [--state <file>] [--once]
                                      wait for work and start a harness for it

A long text can come from a file: --file notes.md, or --file - for stdin.

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
    /* A list keeps the property it once grouped by but never reads it, so the
       columns below come from a board or from nothing. */
    const boards = data.views.filter((v) => v.kind !== "list");
    const view = boards.find((v) => v.isDefault) ?? boards[0];
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
    const body = textArgument(positional[1]);
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
    console.log(`Now start the heartbeat: node board.mjs beat ${task.key} &`);
  },

  /**
   * The heartbeat. It says the process is alive between reports, and it says
   * the process is gone when it is killed with the session.
   *
   * A beat never writes the step, the log or anything else a person reads as
   * progress. It only stops the board from calling a busy agent silent while
   * a long build runs.
   *
   * It closes the run when it is stopped, which is the whole point: the usual
   * way an agent dies is a Ctrl-C that reaches this process too. If the run
   * already ended, the board answers 409 and that is the right answer.
   *
   * It is not a permit to work for ever. After `--for` minutes it exits and
   * leaves the run to the lease on the server, so a heartbeat that outlives
   * its session cannot hold a card open all day.
   */
  async beat() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const run = data.runs.find((r) => r.taskId === task.id);
    if (!run) fail(`No open run on ${task.key}. Claim it first.`, 9);

    const every = Math.max(15, Number(flags.every ?? 120)) * 1000;
    const until = Date.now() + Math.max(1, Number(flags.for ?? 60)) * 60_000;

    let leaving = false;
    const leave = async (why) => {
      if (leaving) return;
      leaving = true;
      await trySend("PATCH", `/api/runs/${run.id}`, { status: "lost", log: why });
      process.exit(0);
    };
    process.on("SIGINT", () => void leave("the agent was stopped"));
    process.on("SIGTERM", () => void leave("the agent was stopped"));

    console.log(`beating for ${task.key} every ${every / 1000}s`);
    while (Date.now() < until) {
      await sleep(every);
      if (leaving) return;
      const status = await trySend("PATCH", `/api/runs/${run.id}`, { beat: true });
      // The run ended under us: finished, taken over, or closed by the board.
      if (status === 409 || status === 404) {
        console.log(`${task.key}: the run is over`);
        return;
      }
    }
    console.log(`${task.key}: heartbeat done, the run now rests on its reports`);
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

  async check() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const text = positional[1];
    if (!text) fail('Give the item: check USH-14 "Retries stop after five tries"');
    await call("POST", `/api/tasks/${task.id}/checklist`, { text });
    console.log(`${task.key}: checklist item added`);
  },

  /**
   * The description is the one field an agent may not write over. A person
   * who wrote one meant it; an agent that disagrees posts a comment, and the
   * person makes it the description with one press. What the agent wrote
   * itself, it may write again.
   */
  async describe() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const text = textArgument(positional[1]);
    if (!text) fail('Give the text: describe USH-14 "…", or --file draft.md');

    const detail = (await call("GET", `/api/tasks/${task.id}`)).task;
    const lastEdit = detail.activity.find((a) => a.kind === "description");
    const mine = lastEdit?.actor?.id === data.me.agent.id;
    if (detail.description.trim() && !mine) {
      fail(
        `${task.key} already has a description that a person wrote. Do not write over it. ` +
          `Post your draft as a comment instead: comment ${task.key} --file draft.md`,
      );
    }
    await call("PATCH", `/api/tasks/${task.id}`, { description: text });
    console.log(`${task.key}: description written`);
  },

  /**
   * A question the agent cannot answer alone. The question goes up as a
   * comment, where the person answers it, and the run waits: the card says
   * so, and the board does not close a waiting run for silence. The watcher
   * wakes the agent again when a person replies.
   */
  async ask() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const question = textArgument(positional[1]);
    if (!question) fail('Give the question: ask USH-14 "Which service owns the queue?"');
    const run = data.runs.find((r) => r.taskId === task.id);
    if (!run) fail(`No open run on ${task.key}. It was taken over, or never claimed.`, 9);

    await call("POST", `/api/tasks/${task.id}/comments`, { body: question });
    const line = question.replace(/\s+/g, " ").trim();
    await call("PATCH", `/api/runs/${run.id}`, {
      status: "waiting",
      step: line.length > 200 ? `${line.slice(0, 197)}…` : line,
      log: "asked a question",
    });
    console.log(`${task.key}: waiting for an answer. End your session now.`);
  },

  /**
   * The answer to a Pause. The board cannot stop a process on another
   * machine, so a person's Pause is a request, and only the agent can say it
   * has stopped. This says it — the report that clears the request — and
   * then waits here for Resume.
   *
   * It waits for `--for` minutes at most, because a harness gives one command
   * a bounded time, and then says to run it again. Running it again reports
   * "still paused", which keeps the lease alive: the board closes a run that
   * has not reported for half an hour, and paused is not dead.
   */
  async pause() {
    const data = await board();
    const task = findTask(data, positional[0]);
    const run = data.runs.find((r) => r.taskId === task.id);
    if (!run) fail(`No open run on ${task.key}. It was taken over, or never claimed.`, 9);

    const first = run.status !== "paused";
    const answer = await call(
      "PATCH",
      `/api/runs/${run.id}`,
      first ? { status: "paused", step: "Paused", log: "paused" } : { status: "paused" },
    );
    if (answer.control === "stop") {
      console.log("control: stop");
      return;
    }
    console.log(`${task.key}: paused. Waiting for Resume.`);

    const every = Math.max(1, Number(flags.every ?? 3)) * 1000;
    const until = Date.now() + Math.max(1, Number(flags.for ?? 5)) * 60_000;
    while (Date.now() < until) {
      await sleep(every);
      let current;
      try {
        current = (await request("GET", `/api/runs/${run.id}`)).run;
      } catch (err) {
        if (err.status === 404) fail(`${task.key}: the run is gone. Stop work.`, 9);
        continue; // the board is away for a moment; the lease is long
      }
      // A person took the card, or the board closed the run. Either way it is not ours.
      if (current.endedAt) fail(`${task.key}: the run is over. Stop work, do not re-claim it.`, 9);
      if (current.control === "stop") {
        console.log("control: stop");
        return;
      }
      if (current.control === "resume") {
        await call("PATCH", `/api/runs/${run.id}`, {
          status: "running",
          step: "Resumed",
          log: "resumed",
        });
        console.log(`${task.key}: resumed. control: none`);
        return;
      }
    }
    console.log(`${task.key}: still paused. Run pause ${task.key} again to keep waiting.`);
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

/** A text argument, or the file `--file` names, or stdin for `--file -`. */
function textArgument(inline) {
  if (!flags.file) return inline;
  try {
    return readFileSync(flags.file === "-" ? 0 : flags.file, "utf8");
  } catch (err) {
    fail(`Could not read ${flags.file}: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Waiting for work                                                    */
/* ------------------------------------------------------------------ */

/*
 * A harness — Claude Code, Codex, pi, OpenCode — answers a prompt and exits.
 * None of them can sit and wait for a board to call. So this does the waiting,
 * and starts one short harness session per piece of work:
 *
 *   the stream rings  ->  read the feed  ->  claim  ->  run the command
 *
 * The stream is a doorbell and nothing more. What happened is read from the
 * activity feed, after the last line this watcher saw, so a task created
 * while the socket was down still arrives when it comes back.
 *
 * The run is the lock. The watcher claims before the harness starts, so the
 * card shows life within a second, and a second watcher on the same board gets
 * a 409 and leaves the task alone. It then keeps the run honest: it beats while
 * the harness works, stops the harness when a person takes the card over or
 * asks it to stop, and closes whatever the harness leaves open.
 */

const TRIGGERS = ["created", "assigned", "mention"];

const PROMPTS = {
  created: (key) => `A person just created task ${key} on the Ushabti board.`,
  assigned: (key) => `Task ${key} on the Ushabti board was just assigned to you.`,
  mention: (key) => `A person mentioned you in a comment on task ${key} on the Ushabti board.`,
  reply: (key) =>
    `A person answered the question you asked on task ${key} on the Ushabti board. ` +
    `Read the newest comments before anything else.`,
};

function promptFor(event, key, goal) {
  return (
    `${PROMPTS[event](key)} Your job: ${goal}. ` +
    `Read ${SKILL_DIR}/SKILL.md first and follow it. ` +
    `The watcher already holds the run on ${key} and beats for it, ` +
    `so do not claim the task and do not start a heartbeat.`
  );
}

/** Quotes a value for a POSIX shell, so a placeholder is one argument. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function fillCommand(template, values) {
  return template.replace(/\{(key|id|event|prompt|skill)\}/g, (_, name) =>
    shellQuote(values[name]),
  );
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

commands.watch = async function watch() {
  const template = flags.run;
  if (!template || template === "true") {
    fail(`Give the command to start: watch --run 'claude -p {prompt}'`);
  }
  const triggers = new Set(
    String(flags.on ?? "assigned,mention")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
  for (const t of triggers) {
    if (!TRIGGERS.includes(t)) fail(`--on takes ${TRIGGERS.join(", ")}. "${t}" is not one.`);
  }
  const goal = String(flags.goal ?? "refine the task so that a developer or an agent can start it");
  const jobs = Math.max(1, Number(flags.jobs ?? 1) || 1);
  const timeout = Math.max(1, Number(flags.timeout ?? 30) || 30) * 60_000;
  const once = flags.once === "true";

  const me = await call("GET", "/api/agent/me");
  const projectId = me.project.id;
  const agentId = me.agent.id;
  const mention = new RegExp(`@${escapeRegExp(me.agent.name)}(?![\\w-])`, "i");

  /* --- where the feed was left ------------------------------------- */

  const readState = () => {
    if (!flags.state) return null;
    try {
      return JSON.parse(readFileSync(flags.state, "utf8"));
    } catch {
      return null;
    }
  };
  const saveState = () => {
    if (!flags.state) return;
    try {
      // The ids near the cursor go too: the overlap reads them again after a
      // restart, and a task that was already handled must not wake twice.
      writeFileSync(
        flags.state,
        JSON.stringify({ projectId, cursor, seen: seenOrder.slice(-500) }),
      );
    } catch (err) {
      say(`could not write ${flags.state}: ${err.message}`);
    }
  };

  const saved = readState();
  let cursor =
    saved?.projectId === projectId && saved.cursor
      ? saved.cursor
      : (await call("GET", `/api/projects/${projectId}/activity`)).now;

  /* Lines are read again across a small overlap, because two writes can
     commit out of the order of their clocks. The ids make that harmless. */
  const OVERLAP_MS = 5_000;
  const seenOrder = saved?.projectId === projectId && Array.isArray(saved.seen) ? saved.seen : [];
  const seen = new Set(seenOrder);
  const remember = (id) => {
    seen.add(id);
    seenOrder.push(id);
    if (seenOrder.length > 5_000) seen.delete(seenOrder.shift());
  };

  /* --- the work ------------------------------------------------------ */

  const queue = [];
  const active = new Map();
  let stopping = false;
  let finishedOne = false;

  function say(line) {
    console.log(`[watch] ${line}`);
  }

  function wake(taskId, key, event) {
    if (active.has(taskId) || queue.some((job) => job.taskId === taskId)) return;
    say(`${key}: ${event}`);
    queue.push({ taskId, key, event });
    pump();
  }

  function pump() {
    while (!stopping && active.size < jobs && queue.length) {
      const job = queue.shift();
      active.set(job.taskId, job);
      void work(job).finally(() => {
        active.delete(job.taskId);
        if (once && finishedOne) void leave(0);
        else pump();
      });
    }
  }

  async function work(job) {
    let runId;
    try {
      if (job.event === "reply") {
        runId = job.runId;
        await request("PATCH", `/api/runs/${runId}`, {
          status: "running",
          step: "Reading the answer",
        });
      } else {
        const { run } = await request("POST", `/api/tasks/${job.taskId}/run`, {
          goal: goal.length > 200 ? `${goal.slice(0, 197)}…` : goal,
          step: "Starting",
        });
        runId = run.id;
      }
    } catch (err) {
      // 409: somebody else holds it, or the run closed. Either way, not ours.
      say(`${job.key}: left alone (${err.message})`);
      return;
    }
    job.runId = runId;
    finishedOne = true;

    const command = fillCommand(template, {
      key: job.key,
      id: job.taskId,
      event: job.event,
      prompt: promptFor(job.event, job.key, goal),
      skill: SKILL_DIR,
    });

    const child = spawn(command, {
      shell: true,
      // Its own process group, so that stopping it stops the harness under
      // the shell too, and not only the shell.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        USHABTI_URL: BASE,
        USHABTI_TOKEN: TOKEN,
        USHABTI_TASK: job.key,
        USHABTI_RUN: runId,
        USHABTI_EVENT: job.event,
      },
    });
    job.child = child;
    const prefix = (stream, out) => {
      let rest = "";
      stream.on("data", (chunk) => {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop();
        for (const line of lines) out.write(`[${job.key}] ${line}\n`);
      });
      stream.on("end", () => rest && out.write(`[${job.key}] ${rest}\n`));
    };
    prefix(child.stdout, process.stdout);
    prefix(child.stderr, process.stderr);

    const exited = new Promise((done) => {
      child.on("exit", (code, signal) => done({ code, signal }));
      child.on("error", (err) => done({ code: 127, signal: null, error: err }));
    });

    /* While the harness works: a beat every two minutes, and a look at the
       run every ten seconds, so a Take over or a Stop ends the work within
       seconds and not at the harness's next report. */
    let why = null;
    let beatDue = Date.now() + 120_000;
    const deadline = Date.now() + timeout;
    const watcher = setInterval(async () => {
      if (why) return;
      if (Date.now() > deadline) {
        why = { status: "failed", log: `ran past --timeout, so the watcher stopped it` };
        return stop(child);
      }
      try {
        const { run } = await request("GET", `/api/runs/${runId}`);
        if (run.endedAt) {
          why = { closed: true };
          say(`${job.key}: the run ended (${run.status}), so the harness is stopped`);
          return stop(child);
        }
        if (run.control === "stop") {
          why = { status: "stopped", log: "stopped, as asked" };
          return stop(child);
        }
        if (Date.now() > beatDue) {
          beatDue = Date.now() + 120_000;
          await request("PATCH", `/api/runs/${runId}`, { beat: true });
        }
      } catch {
        // The board is away for a moment. The lease is there for longer.
      }
    }, 10_000);

    const { code, signal, error } = await exited;
    clearInterval(watcher);
    if (error) say(`${job.key}: could not start the command: ${error.message}`);

    /* Whatever the harness left open, the watcher closes. A waiting run is
       not left open by accident: it asked a person, and stays. */
    try {
      if (why?.closed) return;
      const { run } = await request("GET", `/api/runs/${runId}`);
      if (run.endedAt || run.status === "waiting") {
        say(`${job.key}: ${run.endedAt ? run.status : "waiting for an answer"}`);
        return;
      }
      const close =
        why ??
        (code === 0
          ? { status: "done", log: "the session ended without closing the run" }
          : { status: "failed", log: `the session exited with ${signal ?? `code ${code}`}` });
      await request("PATCH", `/api/runs/${runId}`, close);
      say(`${job.key}: ${close.status}`);
    } catch (err) {
      say(`${job.key}: could not close the run: ${err.message}`);
    }
  }

  function stop(child) {
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }

  /* --- reading what the stream rang about --------------------------- */

  let board = null;
  const freshBoard = async () =>
    (board ??= await request("GET", `/api/projects/${projectId}/board`));

  const assignedToMe = (b, taskId) => {
    const task = b.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    return b.properties.some((p) => p.type === "person" && task.values[p.id] === agentId);
  };

  async function consider(entry) {
    const actor = entry.actor;
    if (!entry.taskId || !actor || actor.id === agentId) return;
    const key = entry.taskKey ?? entry.taskId;

    if (entry.kind === "created") {
      // A task an agent wrote is not a reason for another agent to wake:
      // two watchers would otherwise refine each other's work for ever.
      if (triggers.has("created") && actor.kind === "human")
        return wake(entry.taskId, key, "created");
      if (triggers.has("assigned") && assignedToMe(await freshBoard(), entry.taskId))
        return wake(entry.taskId, key, "assigned");
      return;
    }

    if (entry.kind === "value" && triggers.has("assigned")) {
      const b = await freshBoard();
      const property = b.properties.find((p) => p.id === entry.data.propertyId);
      if (property?.type !== "person") return;
      const task = b.tasks.find((t) => t.id === entry.taskId);
      if (task?.values[property.id] === agentId) return wake(entry.taskId, key, "assigned");
      return;
    }

    if (entry.kind === "comment" && actor.kind === "human") {
      const { task } = await request("GET", `/api/tasks/${entry.taskId}`);
      const comment = task.comments.find((c) => c.id === entry.data.commentId);
      if (!comment) return;
      const run = task.run;
      // An answer comes after the question. A comment older than the moment
      // the run began to wait was written before anybody asked anything.
      const answers =
        run?.agent.id === agentId &&
        run.status === "waiting" &&
        Date.parse(comment.createdAt) >= Date.parse(run.updatedAt);
      if (answers) {
        if (active.has(entry.taskId)) return;
        queue.push({ taskId: entry.taskId, key, event: "reply", runId: run.id });
        say(`${key}: reply`);
        return pump();
      }
      if (triggers.has("mention") && mention.test(comment.body)) {
        return wake(entry.taskId, key, "mention");
      }
    }
  }

  let syncing = null;
  let again = false;

  async function sync() {
    if (syncing) {
      again = true;
      return syncing;
    }
    syncing = (async () => {
      do {
        again = false;
        board = null;
        try {
          for (;;) {
            const after = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
            const { entries } = await request(
              "GET",
              `/api/projects/${projectId}/activity?after=${encodeURIComponent(after)}&limit=200`,
            );
            let fresh = 0;
            for (const entry of entries) {
              if (seen.has(entry.id)) continue;
              remember(entry.id);
              fresh += 1;
              if (entry.createdAt > cursor) cursor = entry.createdAt;
              try {
                await consider(entry);
              } catch (err) {
                say(`could not read ${entry.taskKey ?? "a task"}: ${err.message}`);
              }
            }
            if (entries.length < 200 || fresh === 0) break;
          }
          saveState();
        } catch (err) {
          say(`could not read the feed: ${err.message}`);
        }
      } while (again);
      syncing = null;
    })();
    return syncing;
  }

  let ring = null;
  const rang = () => {
    clearTimeout(ring);
    ring = setTimeout(() => void sync(), 250);
  };

  /* --- the stream ---------------------------------------------------- */

  const aborter = new AbortController();

  async function listen() {
    let backoff = 1_000;
    while (!stopping) {
      try {
        const res = await fetch(`${BASE}/api/projects/${projectId}/stream`, {
          headers: { Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" },
          signal: aborter.signal,
        });
        if (res.status === 401 || res.status === 403) {
          say(`the board refused the token (${res.status}). Stopping.`);
          return leave(1);
        }
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        backoff = 1_000;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop();
          for (const block of blocks) {
            const event = /^event:\s*(\S+)/m.exec(block)?.[1];
            if (event === "ready") {
              say(`listening on ${me.project.name} (${me.project.key}) as ${me.agent.name}`);
              rang();
            } else if (event === "change") {
              rang();
            }
          }
        }
      } catch (err) {
        if (stopping) return;
        say(`the stream broke: ${err.message}`);
      }
      if (stopping) return;
      say(`reconnecting in ${backoff / 1000}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  /* --- leaving ------------------------------------------------------- */

  async function leave(code) {
    if (stopping) return;
    stopping = true;
    aborter.abort();
    for (const job of active.values()) {
      if (job.child) stop(job.child);
      if (job.runId) {
        await trySend("PATCH", `/api/runs/${job.runId}`, {
          status: "lost",
          log: "the watcher was stopped",
        });
      }
    }
    saveState();
    process.exit(code);
  }
  process.on("SIGINT", () => void leave(0));
  process.on("SIGTERM", () => void leave(0));

  say(`on ${[...triggers].join(", ")}, up to ${jobs} at a time: ${template}`);
  await listen();
};

const run = commands[command];
if (!run) fail(`No command "${command}". Try: node board.mjs help`);
await run();
