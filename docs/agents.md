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
| Add a checklist item| `POST /api/tasks/{taskId}/checklist`                |
| Comment             | `POST /api/tasks/{taskId}/comments`                 |

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
- `status` — `running`, `paused`, `done`, `failed`, or `lost` if you are
  being shut down and want the card back on the board at once.

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

### Finish

```http
PATCH /api/runs/{runId}
{ "status": "done", "log": "opened PR #124" }
```

The run closes, the card goes quiet, the Agent tab goes away, and the activity
log keeps the line.

## Errors

| Code | What it means                                                 |
| ---- | ------------------------------------------------------------- |
| 401  | The token is unknown or revoked.                              |
| 403  | The token belongs to another project, or a route only a person may call. |
| 404  | The task, run or project is not there.                        |
| 409  | The task already has an open run, or your run is closed — finished, taken over, or lost. |

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
node board.mjs finish USH-14
```

`step` prints `control: none | pause | stop`, and exit code 9 means the card
was taken over. Those two are the whole contract, and `SKILL.md` says so in the
words a model needs.

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
