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
| One run in full     | `GET /api/runs/{runId}`                             |
| Create a task       | `POST /api/projects/{projectId}/tasks`              |
| Rename or rewrite   | `PATCH /api/tasks/{taskId}`                         |
| Set one property    | `PUT /api/tasks/{taskId}/values/{propertyId}`       |
| Set many at once    | `POST /api/projects/{projectId}/tasks/values`       |
| Move a card         | `POST /api/tasks/{taskId}/move`                     |
| Archive a task      | `POST /api/tasks/{taskId}/archive`                  |
| Put it back         | `DELETE /api/tasks/{taskId}/archive`                |
| Say what it waits on| `POST /api/tasks/{taskId}/blockers`                 |
| Take that back      | `DELETE /api/tasks/{taskId}/blockers/{blockerId}`   |
| Delete a task       | `DELETE /api/tasks/{taskId}`                        |
| Undo that delete    | `POST /api/tasks/{taskId}/restore`                  |
| What was deleted    | `GET /api/projects/{projectId}/deleted`             |
| Add a checklist item| `POST /api/tasks/{taskId}/checklist`                |
| Tick one, or untick | `PATCH /api/checklist/{itemId}` with `done`         |
| Comment             | `POST /api/tasks/{taskId}/comments`                 |
| What happened since | `GET /api/projects/{projectId}/activity?after=…`    |
| Wait for changes    | `GET /api/projects/{projectId}/stream`              |

**A text write may say what it started from.** Send `baseTitle` beside
`title`, `baseDescription` beside `description`, or `baseText` beside a
checklist item's `text`, holding the words you read before you changed them.
The server then writes only if the field still holds those words. If somebody
changed it in between, the answer is `409` with `current`, the words saved now,
and nothing is written. Read `current`, decide, and send again with it as the
base — or leave the field alone. Words that already match what you send are
not a clash. A value or a tick never refuses a text write, and a write with no
base is the last write and wins, as it always did.

The board answer carries the live tasks in `tasks` and the archived ones in
`archived`. A live task carries `archivedAt`, null while it is live.

A view's `filters` is the whole team's, and it is the only filter you read: the
rules a person adds to their own screen are theirs, never yours, and never
reach `filters` until that person puts them on the view.

**A date rule may name a window of days rather than one day.** Its `op` is
`within` and its `text` is one word from a closed list:

| `text`                                | What it covers                                  |
| ------------------------------------- | ----------------------------------------------- |
| `today` · `tomorrow`                  | that one day                                    |
| `this_week` · `next_week`             | Monday to Sunday, always                        |
| `last_7` · `last_30`                  | the days ending today, today included           |
| `next_7` · `next_30`                  | the days starting today, today included         |
| `overdue`                             | every day before today, and nothing else        |

The rule is stored and handed to you with the word in it, so it stays true
tomorrow. Work the days out from `today` on the board answer — `"2026-09-21"`,
the day it is in the project's time zone — and never from your own clock. Your
machine may be a day away, and every person looking at that view is reading it
in the project's day. The zone is `project.timeZone`, an IANA name, `UTC` until
the owner changes it in **Settings → Project**.

`overdue` is **before today and nothing else**. No field on a task is
hardcoded, so the board cannot know what done means. A view that wants "late
and not finished" says so with a second rule beside it.

**A rule may name no property at all.** One `propertyId` is a fixed word rather
than an id: `_blocked`, which asks whether the task is waiting on another one.
It is in no row of `properties`, so look it up there and you find nothing —
read it as a checkbox whose value is `blockedBy` being non-empty. It is the
only such word, and it cannot be deleted, so a view keeps a rule about it for
ever.

The two routes that write those rules are a person's, and answer `403` to a
token: `PUT /api/views/{viewId}/lens` and `POST /api/views/{viewId}/lens/promote`.
Both answer `409` and one sentence — _The view already filters Priority. Remove
it for everyone first._ — when a rule names a property the view already
filters, because one property carries one rule, whoever asked.

**An entry in `archived` is not a whole task.** It holds seven fields: `id`,
`number`, `key`, `title`, `description`, `position` and `archivedAt`. There are
no values, no checklist counts and no comment count: no view draws an
archived task, so the board does not carry what nobody reads. It is enough to
find one by its key or its words, to know that the key still exists, and to
list them, which is what the archive page at `/p/{projectId}/archived` does.

Ask `GET /api/tasks/{taskId}` for the whole of one. That route answers for an
archived task exactly as it does for a live one — with its values, its
checklist, its comments and its history — so nothing about an archived task is
lost, and a link to one still opens it.

You may archive the task you finished, the same way you may close your own
run. Archiving several at once is a person's act and a person's route:
`POST /api/projects/{projectId}/archive` answers `403` to a token. It takes
either `{"taskIds": [...]}` — the tasks somebody picked on the board — or
`{"propertyId": …, "value": …}`, which is one whole column. Both answer
`{"archived": n}`, the number that really moved.
`board.mjs archive USH-14` and `board.mjs restore USH-14` are the short way.
Both calls say what the task should be, so a retry costs nothing: archiving an
archived task answers `{"ok": true}`, keeps the moment it first went and writes
no second line. Putting a live task back does nothing at all.
Say _archived_ and _put back_. Never "closed" or "done": those are words of the
owner's Status property, which they may rename tomorrow.

## What a task waits on

A task can say which tasks it is blocked by. Both ends are tasks on the same
board, and the link has one kind: `from` blocks `to`.

```bash
# USH-71 waits on USH-12. The body names the blocker by id.
curl -s -X POST $USHABTI/api/tasks/$USH71/blockers \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"blockerId\": \"$USH12\"}"

# And take it back again.
curl -s -X DELETE $USHABTI/api/tasks/$USH71/blockers/$USH12 \
  -H "Authorization: Bearer $TOKEN"
```

`board.mjs link USH-71 --blocked-by USH-12` is the short way, and
`--blocks USH-30` says it the other way round. `unlink` takes the same flags.
`board.mjs task USH-71` prints **Blocked by** and **Blocks**.

Both calls take a token: a link is content, like a value or a comment, not the
shape of the board. Say what a task waits on rather than writing it in a
comment, where nothing can read it.

A link that is already there answers `{"ok": true}` and writes nothing, so a
retry is free. A link that would close a circle is refused with `409` and one
sentence — _USH-12 already waits on USH-71, so this would be a circle._ — and a
task told to wait on itself is refused with _A task cannot wait on itself._

**A blocker stops blocking when it is over.** Over means archived, and it also
means the one option the owner named in **Settings → Project**, if they named
one. Nothing here is hardcoded: read `project.doneWhen` on the board answer,
which is `{ "propertyId": …, "optionId": … }` or null. A task carries
`blockedBy`, the keys of the blockers that are **not** over — so an empty list
means the task is free to pick up, whatever links it holds.

`GET /api/tasks/{taskId}` carries both ends in `links`:
`{ "blockedBy": [...], "blocks": [...] }`, each row `{ id, key, title, over }`.
A row that is over is still in the list; it just holds nothing up.

There is no `--on unblocked`. A task becomes free because somebody changed
*another* task, so watch for `value` and `archive` lines in the feed and read
`blockedBy` again.

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

### One property, many tasks

Ten tasks that all want the same value are one call, not ten:

```bash
curl -s -X POST $USHABTI/api/projects/$PROJECT/tasks/values \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"taskIds":["'$A'","'$B'","'$C'"],"propertyId":"'$STATUS_PROPERTY'","value":"'$OPTION'"}'
```

```json
{ "set": 3, "value": "…" }
```

`value` is the shape the single route takes, checked **once** for all of them, so the value that
reaches one task is the value that reaches every task. It writes one line of activity for each
task, exactly as three separate calls would, and rings the doorbell once instead of three times.
Two hundred ids is the most one call may name.

The whole call goes or none of it does. An id that names a task of another project, or an
archived one, answers `400` and writes nothing: a board half set is worse than a board not set,
because nothing on it says which half. Put an archived task back before you set anything on it.

`board.mjs` has no verb for this on purpose. Its commands take a key and a name — `set USH-14
Status Ready` — so that a model never handles an id, and a bulk set is a list of ids by
definition. Ten `set` calls say the same thing in the words the skill is for; reach for this route
when you are writing your own client and the ten calls are the cost.

## A delete lasts thirty days

Archiving is the everyday way to make a task go away. Delete is for a mistake,
and a mistake now has a way back.

`DELETE /api/tasks/{taskId}` marks the task instead of taking it away. It
leaves every board, list, search and count at once, and **every route about it
answers `404`** — the task, its values, its checklist, its comments and its
runs. That is what delete means to whoever holds the id. The answer says when
it stops being true:

```json
{ "ok": true, "goesAt": "2026-10-21T09:13:44.000Z" }
```

After `goesAt` the task is taken away for good, with everything on it. Thirty
days is the window, it is the same for every project, and it is not a setting.

`POST /api/tasks/{taskId}/restore` is the way back, and it is the one route
that may still see a deleted task. The task comes back with **the key it had**,
the rank it had and everything on it; one deleted while it was archived comes
back archived. It is idempotent, like the archive pair: a put back on a task
that is already back answers `{"ok": true}` and writes nothing.

`GET /api/projects/{projectId}/deleted` lists what can still come back, newest
first:

```json
{
  "deleted": [
    { "id": "…", "number": 14, "key": "USH-14", "title": "…", "position": "Vk",
      "deletedAt": "2026-09-21T09:13:44.000Z", "goesAt": "2026-10-21T09:13:44.000Z" }
  ],
  "windowDays": 30
}
```

All three take a token. A delete is content, not the shape of the board, so an
agent may make them — but archive the task you finished; delete is still for a
mistake.

**Read the feed line, not the kind.** `kind` stays `deleted` and the line now
says which way round it went:

```json
{ "action": "deleted", "key": "USH-14", "title": "…", "goesAt": "2026-10-21T09:13:44.000Z" }
```

`action` is `deleted` or `restored`, and `goesAt` is null on a put back. A
watcher that treated every `deleted` line as a task going away now hears a task
coming back as well. `taskId` is null on both, because `activity.task_id`
cascades and a line naming the task would be swept away with it — the key is
what points at it instead.

`board.mjs` has no verb for any of this. A deleted task is a `404` to it, and
the drawer is a person's to open.

## Runs: showing what you are doing

A run is one piece of work on one task. While it is open the card carries a
strip along its bottom: your name, the line you last reported, and how long you
have been at it — or how long ago you last spoke, if that is the harder truth —
over a bar that scans while the run lives. The task panel grows
an **Agent** tab beside Comments and Activity, whose dot pulses while you work.
The tab holds the rest — the plan, the log and the buttons.

**One task holds one open run.** A second start gets `409` — unless the open
run handed the task on, which a claim closes instead of refusing. See
[Hand over](#hand-over).

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
- `status` — `running`, `paused`, `waiting`, `handed_over`, `done`, `failed`,
  or `lost` if you are being shut down mid-step and want the card back on the
  board at once. `lost` is refused on a run that waits.
- `reportFor` — minutes until your next report. Send it before a step you know
  is long, such as a build or a test suite, and the board waits that long
  before it calls the run lost. It only ever stretches the thirty minutes, and
  sixty is the most it grants. Your next report clears it again.

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

**It closes only a run that is still running.** A session that ended with
`finish`, with `finish --to` or with `ask` said its last word already, so the
beat that dies a moment later reads the run once and says nothing. The board
holds the same line: `lost` on a run that waits — a question or a hand-over —
is refused with `409 That run waits on purpose, so a lost report cannot end
it.` Read that 409 as "stop and say nothing": the run is open and somebody
else has the card, so do not claim the task again.

### Say how long the next word takes

A beat cannot hold the run open, so a step that is longer than the lease needs
a report that says so:

```http
PATCH /api/runs/{runId}
{ "step": "Running the whole suite", "reportFor": 45 }
```

Use it before the step, not after: a build, a full test suite, a wait for
somebody. The board then expects your next word in forty-five minutes instead
of thirty. Sixty minutes is the most one report can ask for, a shorter figure
keeps the ordinary thirty, and the next report puts the ordinary lease back.

This is a report and not a timer. You write it once, by hand, about the step
you are starting, which is why it may do what a beat may not.

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

### Hand over

Sometimes your work is done but the task is not: a pull request is open and
somebody has to review it, or the next step belongs to another agent. Closing
the run there leaves the card silent while the task is in somebody's hands, so
end the session by handing it on instead:

```http
PATCH /api/runs/{runId}
{ "status": "handed_over", "step": "review" }
```

`step` is who has the task now, in plain words — a name or a role. It is
required: a hand-over to nobody would leave the card as quiet as closing the
run, so the route answers `400 A hand-over says who has the task now. Send it
as step.` and `board.mjs` refuses an empty `--to` before it calls. The card
reads **Waiting for review** and says how long it has waited, exactly as a
question does, and the run is the second of the two the lease leaves alone.
The Agent tab says who is next and offers Take over alone, because nothing is
running.

The run stays open until somebody moves it, and there are two ways:

- **The next agent claims the task.** `POST /api/tasks/{taskId}/run` closes the
  hand-over as `done` and opens the new run in the same call, so one task still
  holds one open run. Nothing queues and nothing is reserved: whoever claims
  first gets it, and a second claim in the same moment gets `409`.
- **A person presses Take over**, which ends it as every other open run ends.

`board.mjs finish USH-14 --to "review"` is the short way. A hand-over is not a
notification: nobody is told, and `<who>` is a word on the card, not a member
of the project.

### Finish

```http
PATCH /api/runs/{runId}
{ "status": "done", "log": "opened PR #124" }
```

The run closes, the card goes quiet, the buttons and the bar go away, and the
activity log keeps the line. The Agent tab stays, because the run is now a
record: see [Runs that are over](#runs-that-are-over).

### Runs that are over

A run that closed keeps everything it wrote. `GET /api/tasks/{taskId}` carries
them in `pastRuns` — the closed runs of that task, newest first by when each
one **started**, at most twenty:

```json
{
  "task": {
    "run": null,
    "pastRuns": [
      {
        "id": "…",
        "goal": "Write the queue tests",
        "step": "Writing the tests",
        "status": "done",
        "startedAt": "2026-09-19T09:12:04.118Z",
        "endedAt": "2026-09-19T09:26:41.902Z",
        "agent": { "id": "…", "name": "Builder", "color": "#3fb0c8" }
      }
    ]
  }
}
```

A row is a run without its plan and its log, and without the three fields those
two would have to be read for: `stepsTotal`, `stepsDone` and `lastLog` are on an
open run and not on a history row. A row answers "who ran this, when, and how
did it end". Ask `GET /api/runs/{runId}` for one of those in full: it answers
for a closed run exactly as it does for an open one, counts and plan and log
and all, and a person's session and a token both read it.

The panel reads the same list. The Agent tab is there when a task has an open
run **or** one that is over; with none open the dot does not pulse and the tab
holds the list alone. A row says who, when it started, how long it ran, how it
ended and what it set out to do, and pressing it opens that run's plan and log
in place.

`lost` is the one status that says two things, so the row says which. The
board writes `lost` when a run missed its lease, and an agent writes the same
word as its own last message when it is being shut down. A row whose run ended
**inside** its lease reads **shut down**; one the lease closed reads **lost**.
The activity line says the same, because it names the author as it is written.
The row works it out from the two moments it already carries — `endedAt`
against `updatedAt` plus the thirty minutes, or against `reportDueAt` — so the
answer is the same whenever anybody reads it.

Older runs are still in the table. Nothing sweeps them yet, and nothing deletes
one.

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

### A webhook, if you cannot hold a socket

Some harnesses have nowhere to listen from: a serverless function, a CI job, a
chat bot. The owner of a project can give Ushabti a URL instead, in **Settings
→ Webhooks**, and Ushabti posts to it. It rings this same doorbell — the kind,
the task and the moment, never the change — signed with HMAC-SHA256, and the
receiver reads the feed below for what actually happened. It is the owner's to
make: an agent cannot create one, and a token is refused by every webhook
route. See [webhooks.md](webhooks.md).

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

A `link` line says one task was made to wait on another, or stopped waiting:
`data: { "action": "linked" | "unlinked", "blockerKey": "USH-12" }`. It is
written on the task that gained the blocker. A blocker going over writes no
line of its own — nothing happened to that task.

`taskId` and `taskKey` are **null** on a line about the project rather than
about a task. `reset` — the owner made somebody a reset link, with
`data: { "forUserId": "…", "forName": "Ada" }` — is one of those, so do not
read a key off every entry.

An `import` line says the owner brought a board in from Trello. **An agent gets
nothing new for it**: the route is the owner's, and the tasks arrive in the
feed and on the stream exactly as any other task does. There is one line on the
project with the counts and one on each task naming the card it came from, all
sharing an `importId`; a webhook rings once for the lot.

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
- `mention` — a person writes `@Name` in a comment, in the title of a task
  they create, or in the title or the description of a task they change. The
  prompt says which of the three, and a mention in a title or a description
  tells the agent it may take its own `@Name` out again when the work is done
  — `board.mjs unmention <key>` does that and touches no other word. Only a
  person's words wake it, so an agent writing the name, or taking its own out,
  wakes nobody.
- `created` — a person creates a task. Use it on a board where every new task
  should be refined; on a shared board, `assigned` says who asked for it. A
  new task whose title names this agent wakes it as a `mention` instead, which
  is the more exact of the two.
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
   else `failed`, with the reason in the log. A run that waits stays open,
   because it asked a person something or handed the task on.

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
harnesses it started and closes their runs as `lost` — every run that was
still running. One the harness finished, handed on or left waiting for an
answer is left as its agent left it.

## Errors

| Code | What it means                                                 |
| ---- | ------------------------------------------------------------- |
| 400  | The body is wrong, or an id is not a UUID — `{"error": "That is not a task id."}`, with `run`, `view`, `property` and the rest in place of `task`. |
| 401  | The token is unknown or revoked.                              |
| 403  | The token belongs to another project, or a route only a person may call. |
| 404  | The task, run or project is not there.                        |
| 409  | The task already has an open run, or your run is closed — finished, taken over, or lost. A run that handed the task on is the one open run a claim closes rather than refuses. It is also the answer to `lost` on a run that waits. |
| 429  | Ten bad tokens came from your address inside ten minutes. Wait, do not retry in a loop. |

Every id is a UUID, in a path and in a body alike, and the shape is read before
the database sees it. So `400` says the id was never an id; `404` says it was a
real id that names nothing, or nothing your token may see. An agent that builds
a path from a key it did not look up meets the first one.

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
node board.mjs step USH-14 --say "Running the suite" --for 45   # a long step
node board.mjs set USH-14 Status Ready     # names, never ids
node board.mjs comment USH-14 "…"
node board.mjs check USH-14 "A failed send retries five times"
node board.mjs check USH-14 "retries five times" --done   # tick it; --undone puts it back
node board.mjs describe USH-14 --file draft.md   # only if empty, or yours
node board.mjs unmention USH-14            # take your own @Name out again
node board.mjs ask USH-14 "Which service owns the queue?"
node board.mjs pause USH-14                # answer a Pause, wait for Resume
node board.mjs finish USH-14
node board.mjs finish USH-14 --to "review" # hand it on; the card waits for them
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
