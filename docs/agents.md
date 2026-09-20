# Agents

An agent is a member of a project. It is not a second class of user with its
own rules: it holds a person property, writes comments, appears in the activity
log and shows up in the member list, exactly like a person. Two things are its
own:

- it signs in with a **token** instead of a password, and
- while it works it opens a **run** on a task, which is what makes the card
  live on everybody's board.

## Make one

Open **Settings → People**, at `/p/{projectId}/settings/people`. Only the
owner of the project sees the controls.

1. Type a name, for example `Builder`, and press **Add agent**.
2. Press **Connect**. A panel opens with the token and the three commands that
   put it to work, each with a copy button and each already carrying this
   board's own address. Copy the token now: the database keeps a SHA-256
   digest, so nothing can read it back — not the owner, not the server, not
   you.
3. Paste the commands. The panel says **Waiting for the first call…** until the
   token is used, and then says the agent answered.

A token opens **one project**. Revoke it with the ✕ next to it; the agent stops
working within one request.

An agent is a member, not an owner. It writes task values, comments and runs.
It cannot delete a property, an option or a view, and it cannot write its own
run's control word — see [Obey the control word](#obey-the-control-word).

## Sign in

Send the token as a bearer token on every call.

```bash
export USHABTI=http://localhost:3000
export TOKEN=ush_…

curl -s $USHABTI/api/agent/me -H "Authorization: Bearer $TOKEN"
```

```json
{
  "agent": { "id": "…", "name": "Builder", "color": "#3fb0c8" },
  "project": { "id": "…", "name": "Ushabti roadmap", "key": "USH", "role": "member" }
}
```

`/api/agent/me` is the only call that needs no project id: everything an agent
needs to start is in the token.

## Read and write the board

Every route below takes the same token. They are the routes the browser uses,
so an agent sees exactly what a person sees and nothing more.

| What                | Call                                               |
| ------------------- | -------------------------------------------------- |
| The whole board     | `GET /api/projects/{projectId}/board`               |
| One task in full    | `GET /api/tasks/{taskId}`                           |
| Create a task       | `POST /api/projects/{projectId}/tasks`              |
| Rename or rewrite   | `PATCH /api/tasks/{taskId}`                         |
| Set one property    | `PUT /api/tasks/{taskId}/values/{propertyId}`       |
| Move a card         | `POST /api/tasks/{taskId}/move`                     |
| Archive a task      | `POST /api/tasks/{taskId}/archive`                  |
| Put it back         | `DELETE /api/tasks/{taskId}/archive`                |
| Add a checklist item| `POST /api/tasks/{taskId}/checklist`                |
| Comment             | `POST /api/tasks/{taskId}/comments`                 |
| What happened since | `GET /api/projects/{projectId}/activity?after=…`    |
| Wait for changes    | `GET /api/projects/{projectId}/stream`              |

The board answer carries the live tasks in `tasks` and the archived ones in
`archived`. An archived task is off every board and list; it keeps its
comments, its checklist, its history and its link, and every task carries
`archivedAt` — null while it is live. `GET /api/tasks/{taskId}` answers for an
archived task as it does for any other, so a link still opens one.

You may archive the task you finished, the same way you may close your own
run. Sweeping a whole column is a person's act and a person's route.
`board.mjs archive USH-14` and `board.mjs restore USH-14` are the short way.
Say _archived_ and _put back_. Never "closed" or "done": those are words of the
owner's Status property, which they may rename tomorrow.

The board answer carries `properties`, so an agent finds the property it wants
by name and reads the option ids out of it. **Never hardcode a property or an
option**: the person who owns the board may rename Status to Stage tomorrow,
and every field on a task is theirs to change.

```bash
# "In Progress" is an option of a property somebody defined. Look it up.
curl -s $USHABTI/api/projects/$PROJECT/board -H "Authorization: Bearer $TOKEN" \
  | jq -r '.properties[] | select(.name=="Status") | .options[] | select(.name=="In Progress") | .id'
```

Then write it:

```bash
curl -s -X PUT $USHABTI/api/tasks/$TASK/values/$STATUS_PROPERTY \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"value":"'$OPTION'"}'
```

## Runs: showing what you are doing

A run is one piece of work on one task. While it is open the card carries a
strip along its bottom: your name, the line you last reported, and how long you
have been at it — or how long ago you last spoke, if that is the harder truth —
over a bar that scans while the run lives. The task panel grows
an **Agent** tab beside Comments and Activity, whose dot pulses while you work.
The tab holds the rest — the plan, the log and the buttons.

**One task holds one open run.** A second start gets `409`.

### Start

```http
POST /api/tasks/{taskId}/run
{
  "goal": "Write the offline queue tests",
  "step": "Reading the queue module",
  "steps": ["Read the queue module", "Draft the criteria", "Write the tests"]
}
```

`steps` is optional. With it the Agent tab shows the plan, ticking steps off as
you report them; without it the tab shows the line and the log alone. The card is
the same either way: one line, and the bar that says you are alive.

### Report

Call this whenever the step changes — that is the whole loop.

```http
PATCH /api/runs/{runId}
{ "step": "Writing the tests", "stepIndex": 2, "log": "write tests/queue.spec.ts" }
```

- `step` — one line, what you are doing now. It is what the card shows.
- `stepIndex` — which step of the plan you are on, counting from zero.
  Everything before it becomes done.
- `log` — one line for the run log in the Agent tab. If you leave it out, `step`
  is logged instead.
- `steps` — a new plan, if the work turned out different.
- `status` — `running`, `paused`, `waiting`, `done`, `failed`, or `lost` if
  you are being shut down and want the card back on the board at once.

The answer is `{ "run": …, "control": … }`.

### Beat, so that silence means something

The board cannot see your machine. If you are killed, nothing writes your run
again, and the card would read as work in progress for ever. So the board
counts your reports, and closes a run that has none:

- **No report for six minutes** and the card stops saying how long you have
  worked. It says how long ago you last spoke instead.
- **No report for thirty minutes** and the board closes the run as `lost`. The
  task goes back on the board for whoever wants it, and your next `PATCH` gets
  `409`.

A long build is not a dead agent, though, so there is a second signal:

```http
PATCH /api/runs/{runId}
{ "beat": true }
```

A beat says one thing: the process is alive. It writes no step, no log and no
progress of any kind, and it **cannot** extend the thirty minutes. That is on
purpose. A beat is a timer, and a timer left running by a killed session would
otherwise hold a card open all day — the exact fault the lease exists to fix.
What a beat buys you is the word on the card: an agent that beats but does not
report reads as `quiet`, not `silent`.

`board.mjs beat USH-14 &` does this for you. It beats every two minutes, it
stops when the run ends, it gives up after an hour, and when it is killed with
your session it closes the run itself, which is the fastest honest answer the
board can get.

### Obey the control word

`control` is what a person asked for from the board: `pause`, `resume`, `stop`,
or `null` when nobody asked for anything. Nothing forces you — Ushabti cannot
reach into your process — so this is a contract you keep:

```js
const { control } = await report({ step: "Writing the tests", stepIndex: 2 });
if (control === "stop") await report({ status: "stopped" });
if (control === "pause") await report({ status: "paused" });
```

Reporting the matching status clears the request. Until you do, the Agent tab
says you have not answered yet.

**Take over** is different. A person pressing **Take over** — or dragging a card
you hold — ends the run there and then. Your next `PATCH` gets `409`, and that
means: stop, a person owns this card now.

### Ask, and wait

Sometimes the work cannot go on without a person. Post the question as a
comment, where the person answers it, and report:

```http
PATCH /api/runs/{runId}
{ "status": "waiting", "step": "Which service owns the queue?" }
```

The card shows the question and how long it has waited, and the Agent tab
says to answer in a comment. A waiting run is the one open run the board never
closes for silence: it stopped on purpose, so its silence is not evidence of
anything. Take over still ends it at any moment. Report `running` when you
pick the work up again.

`board.mjs ask USH-14 "…"` does both calls, and the watcher below wakes you
when a person answers.

### Finish

```http
PATCH /api/runs/{runId}
{ "status": "done", "log": "opened PR #124" }
```

The run closes, the card goes quiet, the Agent tab goes away, and the activity
log keeps the line.

## Wait for work

Every harness in use today — Claude Code, Codex, pi, OpenCode — answers a
prompt and exits. None of them can sit and wait for a board to call. So the
waiting is done by a small process beside the harness, and the harness is what
it starts:

```text
the stream rings  ->  read the feed  ->  claim the task  ->  run the harness
```

### The stream is a doorbell

`GET /api/projects/{projectId}/stream` takes the bearer token like every other
route. It sends `event: ready` once it is subscribed, then `event: change`
whenever anything in the project changes, and a comment line every 25 seconds
to keep the socket open. An event says *that* something changed, never what:
server-sent events drop whatever happens while the socket is down, so nothing
may depend on them arriving.

### The feed is what it rang about

```http
GET /api/projects/{projectId}/activity?after=2026-09-18T15:28:52.024Z
```

```json
{
  "entries": [
    {
      "id": "…",
      "kind": "created",
      "taskId": "…",
      "taskKey": "USH-31",
      "data": { "title": "Make the queue retry" },
      "createdAt": "2026-09-18T15:29:10.415Z",
      "actor": { "id": "…", "name": "Ada", "kind": "human" }
    }
  ],
  "now": "2026-09-18T15:29:11.002Z"
}
```

Read it on every `ready` and every `change`, after the last line you saw, and
a task created while your socket was down still reaches you. Without `after`
it answers only `now`, which is where a new reader starts. Read a few seconds
before your cursor and skip the ids you have seen: two writes can commit out of
the order of their clocks.

`actor.kind` is there so that an agent can leave alone what another agent did.
Two agents that each react to the other's new tasks refine each other for ever.

### Listening

While an agent holds the stream open, the board says it is **listening**: a
ringed avatar in the top bar of the board, and "listening now" beside the
token in **Settings → People**. That is the only thing that makes an agent hear
a new task, so it is the only thing the word means. A token that made a call
yesterday is not listening.

The stream writes the moment on the token every 25 seconds and clears it when
the socket closes. The board compares it with a one-minute lease, so a process
that dies without closing anything stops reading as listening by itself.

### `board.mjs watch`

The skill carries a watcher, so you do not have to write one:

```bash
node board.mjs watch --on assigned,mention \
  --run 'claude -p {prompt} --allowedTools "Bash(node:*)"'
```

`--run` is any command that takes a prompt and exits. It runs through the
shell, with these filled in, each quoted as one argument:

| Placeholder | What it is                                                     |
| ----------- | -------------------------------------------------------------- |
| `{prompt}`  | What happened, the job, and the path of `SKILL.md` to read     |
| `{key}`     | The task key, `USH-31`                                         |
| `{id}`      | The task id                                                    |
| `{event}`   | `created`, `assigned`, `mention` or `reply`                    |
| `{skill}`   | The folder the skill is in                                     |

The same values are in the environment of the command, as `USHABTI_TASK`,
`USHABTI_RUN` and `USHABTI_EVENT`, beside `USHABTI_URL` and `USHABTI_TOKEN`.

```bash
--run 'claude -p {prompt} --allowedTools "Bash(node:*)"'
--run 'codex exec {prompt}'
--run 'pi -p {prompt}'
--run 'opencode run {prompt}'
```

What wakes it:

- `assigned` — a person property of a task is set to this agent, when the task
  is made or later, by a field or by a drag on a board grouped by that person.
- `mention` — a person writes `@Name` in a comment.
- `created` — a person creates a task. Use it on a board where every new task
  should be refined; on a shared board, `assigned` says who asked for it.
- An answer to a question the agent asked always wakes it. There is no flag.

What it does for each one:

1. **Claims first.** The run opens before the harness starts, so the card shows
   life within a second and the harness cold start hides behind "Starting". A
   second watcher on the same board gets a 409 and leaves the task alone: the
   run is the lock, and there is no other.
2. **Starts the command** and prints its output with the task key in front.
3. **Keeps the run honest.** It beats every two minutes and looks at the run
   every ten seconds. Take over, or Stop, ends the harness within seconds, not
   at its next report.
4. **Closes what the harness left open.** A clean exit becomes `done`, anything
   else `failed`, with the reason in the log. A waiting run stays open, because
   it asked a person something.

| Flag        | Default              | What it does                                   |
| ----------- | -------------------- | ---------------------------------------------- |
| `--on`      | `assigned,mention`   | What wakes it                                  |
| `--goal`    | refine the task      | The job, in the prompt and on the run          |
| `--jobs`    | `1`                  | How many harness sessions run at once          |
| `--timeout` | `30`                 | Minutes before a session is stopped as failed  |
| `--state`   | none                 | A file that keeps the cursor across restarts   |
| `--once`    | off                  | Exit after the first piece of work             |

Without `--state`, a watcher that restarts begins at the server's clock and
misses what happened while it was down. Give it a file when it runs under
launchd, systemd or a container that restarts it.

It needs a POSIX shell for `--run`. It reconnects by itself, backing off up to
30 seconds, and catches up from the feed when it does. `Ctrl-C` stops the
harnesses it started and closes their runs as `lost`.

## Errors

| Code | What it means                                                 |
| ---- | ------------------------------------------------------------- |
| 401  | The token is unknown or revoked.                              |
| 403  | The token belongs to another project, or a route only a person may call. |
| 404  | The task, run or project is not there.                        |
| 409  | The task already has an open run, or your run is closed — finished, taken over, or lost. |
| 429  | Ten bad tokens came from your address inside ten minutes. Wait, do not retry in a loop. |

A token that works is never counted and never slowed, so a working agent never
meets the 429. If you do meet it, the token is wrong: fix it rather than retry.
The answer carries `Retry-After` in seconds and reads
`{"error": "Too many tries. Wait 8 minutes and try again."}`. The same limit
sits on sign-in and sign-up, which an agent does not use.

## Teaching an agent to use this

An agent knows none of the above until you put it in front of one. Nothing here
is discovered automatically.

The short way is the **skill**, which the board serves to you. **Settings →
People → Connect** prints these three commands with your address and your token
already in them, so you should not have to type any of this by hand:

```bash
mkdir -p ~/.claude/skills/ushabti && \
  curl -sL $USHABTI_URL/skill/SKILL.md  -o ~/.claude/skills/ushabti/SKILL.md && \
  curl -sL $USHABTI_URL/skill/board.mjs -o ~/.claude/skills/ushabti/board.mjs

export USHABTI_URL=https://board.example.com
export USHABTI_TOKEN=ush_…
```

It is two files: a `SKILL.md` that says how to behave on somebody else's board,
and a `board.mjs` that turns the API into commands and does the property
lookups, so a model never handles an id. They live in
`examples/skill/ushabti/` in the repository and are served from any running
board at `/skill/SKILL.md` and `/skill/board.mjs`, which is the copy that
matches the version you are talking to.

Claude Code then loads it only when the work touches the board — when you name
a task key, ask what is in the backlog, or ask it to pick something up. The
commands are:

```bash
node board.mjs list --free                 # what nobody is working on
node board.mjs task USH-14                 # one task in full
node board.mjs claim USH-14 --goal "…" --plan "a|b|c"
node board.mjs step USH-14 --index 1 --say "Writing the tests" --log "…"
node board.mjs set USH-14 Status Ready     # names, never ids
node board.mjs comment USH-14 "…"
node board.mjs check USH-14 "A failed send retries five times"
node board.mjs describe USH-14 --file draft.md   # only if empty, or yours
node board.mjs ask USH-14 "Which service owns the queue?"
node board.mjs pause USH-14                # answer a Pause, wait for Resume
node board.mjs finish USH-14
node board.mjs watch --on assigned --run 'claude -p {prompt}'
```

`step` prints `control: none | pause | stop`, `pause` answers the first of
those and waits for Resume, and exit code 9 means the card was taken over.
That is the whole contract, and `SKILL.md` says so in the words a model needs.

For another framework, put the text of `SKILL.md` in the system prompt and ship
`board.mjs` next to your agent. It needs Node 18 or later and nothing else.

## A worked example

[`examples/agent.mjs`](../examples/agent.mjs) is a small agent with no
dependencies. It reads the board, finds a task, opens a run with a plan, walks
the plan, obeys the control word and closes the run. It is about a hundred
lines, and it is meant to be read and then thrown away.

```bash
npm run db:seed          # creates the demo agent and its token
USHABTI_TOKEN=ush_demo_seed_token_not_for_real_use node examples/agent.mjs
```

Watch the board while it runs.

## Where the design comes from

The card is the agent strip of `Roadmap Board`, kept exactly as it is drawn
there. Everything else comes from the studies in `Agent Activity Studies`: the
status line, the ringed avatar, the step plan and the run log, all of which live
in the Agent tab, where there is room to read them.
