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
owner of the project and its admins see the controls.

1. Type a name, for example `Builder`, and press **Add agent**.
2. Press **Connect**. A box asks for a name for the token, filled in with
   today's date. Change it if you like, for example to the machine that will
   use it, and press **Make token** or Enter. A panel opens with the token and
   the three commands that put it to work, each with a copy button and each
   already carrying this board's own address. Copy the token now: the
   database keeps a SHA-256 digest, so nothing can read it back — not the
   owner, not the server, not you.
3. Paste the commands. The panel says **Waiting for the first call…** until the
   token is used, and then says the agent answered.

A token opens **one project**. An agent can have more than one token, for
example one for each machine. Each token row shows its name, its prefix and
the day it was made. Revoke a token with the ✕ next to it. The question names
the token. When it is the agent's last live token, the agent stops working
within one request. Otherwise the agent keeps working on its other tokens.

An agent is a member, never an owner or an admin, whoever made it. It writes
task values, comments and runs. Every route that is an admin's refuses a
token with `403 Only a person can do this.`
It cannot add a property either, though a member who is a person may: an
agent fills properties in and leaves their shape to the people.
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
  "project": { "id": "…", "name": "Ushabti roadmap", "key": "USH", "role": "member", "waiting": 2 }
}
```

`/api/agent/me` is the only call that needs no project id: everything an agent
needs to start is in the token. `project.waiting` is how many live tasks have
an open run that waits for a person, as the top bar counts them.

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
| Make it part of one | `PUT /api/tasks/{taskId}/parent`                    |
| Take it out again   | `DELETE /api/tasks/{taskId}/parent`                 |
| Delete a task       | `DELETE /api/tasks/{taskId}`                        |
| Undo that delete    | `POST /api/tasks/{taskId}/restore`                  |
| What was deleted    | `GET /api/projects/{projectId}/deleted`             |
| Add a checklist item| `POST /api/tasks/{taskId}/checklist`                |
| Tick one, or untick | `PATCH /api/checklist/{itemId}` with `done`         |
| Comment             | `POST /api/tasks/{taskId}/comments`                 |
| What happened since | `GET /api/projects/{projectId}/activity?after=…`    |
| Wait for changes    | `GET /api/projects/{projectId}/stream`              |

**A create gets the type's defaults.** When the project names a select as its
Type, a property can say what a new task of each type starts with: "a Bug
starts with Severity Minor". It is in `config.defaults` of that property,
keyed by the option id of the type. `POST /api/projects/{projectId}/tasks`
reads the type from the `values` you send and writes the defaults of every
property you did not send and that the type shows. A value you send always
wins, even an empty one, so send `null` to start a property empty. The
answer carries `task.values`: what the task holds once the create is done,
defaults included, so you need not read it back.

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

A view's `kind` says how it draws the tasks: `board` in columns of its
`groupById` property, `list` one task on each line, and `roadmap` one bar for
each option of its `groupById` select that has a target date. A roadmap's
`groupById` is always a select, and its property cannot be deleted while the
view names it, as with a board.

A view's `filters` is the whole team's, and it is the only filter you read: the
rules a person adds to their own screen are theirs, never yours, and never
reach `filters` until that person puts them on the view.

**A person rule may say Me.** Its `values` may hold `"__me__"` beside member
ids and `"__none__"`. It means whoever reads the view, and for you that is your
own user id — `agent.id` from `GET /api/agent/me`. The word is stored, never an
id, so `Assignee is Me` on a shared view means each person, and you. The board
answer hands you every task and hides none; `filters` is what a view asks, and
applying it is yours to do.

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

**A rule may name no property at all.** Four `propertyId`s are fixed words
rather than ids. `_blocked` asks whether the task is waiting on another one:
read it as a checkbox whose value is `blockedBy` being non-empty.
`_agent_waiting` asks whether an agent waits for a person on the task: read it
as a checkbox whose value is the task's run in `runs` having `status`
`waiting`. A `handed_over` run does not count. `_created` and `_updated` ask
when the task was made and last changed: read each as a date whose value is
the day of `createdAt` or `updatedAt` in the project's `timeZone`. They take
`on`, `before`, `after` and `within` with `today`, `this_week`, `last_7` or
`last_30`, and never `empty`. None of these words is in a row of
`properties`, so look it up there and you find nothing. None can be deleted,
so a view keeps a rule about one for ever.

The two routes that write those rules are a person's, and answer `403` to a
token: `PUT /api/views/{viewId}/lens` and `POST /api/views/{viewId}/lens/promote`.
A person's order lives in the same lens, so the `lensSort` of every view an
agent reads is `null`; `sort` is the view's own, and the one to work from.
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
means any of the options the owner ticked in **Settings → Project**, such as
Done and Won't do. Nothing here is hardcoded: read `project.doneWhen` on the
board answer, which is `{ "propertyId": …, "optionIds": [ … ] }` or null. It
used to carry one `optionId`; it is a list now, and a list of one when a single
option was named. A write still takes `optionId` and reads it as a list of one,
and an option of another property is refused with `400`. A task carries
`blockedBy`, the keys of the blockers that are **not** over — so an empty list
means the task is free to pick up, whatever links it holds.

`GET /api/tasks/{taskId}` carries both ends in `links`:
`{ "blockedBy": [...], "blocks": [...] }`, each row `{ id, key, title, over }`.
A row that is over is still in the list; it just holds nothing up.

There is no `--on unblocked`. A task becomes free because somebody changed
*another* task, so watch for `value` and `archive` lines in the feed and read
`blockedBy` again.

## What a task is part of

A task can be split into parts: a part names one parent, and the parent
lists its parts. It is one level deep. A part has no parts of its own, and a
task that has parts is part of nothing.

```bash
# USH-71 is part of USH-12. The body names the parent by id.
curl -s -X PUT $USHABTI/api/tasks/$USH71/parent \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"parentId\": \"$USH12\"}"

# And take it out again.
curl -s -X DELETE $USHABTI/api/tasks/$USH71/parent \
  -H "Authorization: Bearer $TOKEN"
```

`board.mjs parent USH-71 USH-12` is the short way, and `board.mjs unparent
USH-71` takes it out. `board.mjs task` prints **Parent** and **Children**.

Both calls take a token, as a blocker does: splitting work is content. A task
has one parent at most, so a `PUT` on a task that has one moves it to the new
parent, and the answer names the parent it left in `left` (null when it had
none). The parent it already has answers `{"ok": true}` and writes nothing.
Each of these is refused with `409` and one sentence: a task made part of
itself, a parent that is itself a part, and a parent for a task that has parts.

`GET /api/tasks/{taskId}` carries `parent`, one row `{ id, key, title, over }`
or null, and `children`, the same rows in board order. `parts` is `{ "done": 3, "total": 5 }`, or null when the task has
no children; it is on the board answer too. `done` follows the project's Done
when, an archived child counts as done, and a deleted child is not counted. A part is never a
blocker: it puts no chain on a card and is not in `blockedBy`. The feed writes
a `link` line on the part, with `action` `parented` or `unparented` and the
`parentKey`. The export carries each task's `parent` as a key.

The board answer carries `properties`, so an agent finds the property it wants
by name and reads the option ids out of it. **Never hardcode a property or an
option**: the person who owns the board may rename Status to Stage tomorrow,
and every field on a task is theirs to change.

```bash
# "In Progress" is an option of a property somebody defined. Look it up.
curl -s $USHABTI/api/projects/$PROJECT/board -H "Authorization: Bearer $TOKEN" \
  | jq -r '.properties[] | select(.name=="Status") | .options[] | select(.name=="In Progress") | .id'
```

An option of a single select may also carry a plan: `startAt`, `targetAt`
and `shippedAt`, each a day as `YYYY-MM-DD` or null, and `note`, markdown or
null. That is how a board says what a Version, a Sprint or a Quarter is — an
option with dates — so read them from the same `options` rows; there is no
other route. `POST /api/properties/{id}/options` and `PATCH
/api/options/{id}` take the four, each optional, and null clears one. A date
that does not parse, or a target before the start, is refused with `400` and
one sentence. A multi-select option is a label and carries none of them.
`config.dated` on the property says whether its options carry dates: it
decides what Settings shows and whether a filter offers "current", and only a
person who is the owner or an admin writes it.
A sprint property, type `iteration`, is a select whose options always carry dates, one
per sprint. `config.cadence` on it is `{ "length": 14 }`: a sprint's length
in days. A property with no cadence saved reads as 14. A sprint ends only
when a person ships it; one past its target stays open, and nothing on the
server closes it. Until it ships it is still the current sprint, the one an
"is current" filter, a picker and a new task name, and the sprint whose dates
hold today becomes current when it does. When a sprint is closed and no open sprint follows
it, the server makes the next one in the same transaction: it starts the day
after the last option's target, lasts `length` days, and takes the last name
with its trailing number plus one ("Sprint 14" to "Sprint 15"; a name with
no number gets " 2"). Write it with `PATCH /api/properties/{id}` and
`{"cadence":{"length":7}}`, a whole number from 1 to 365; only a person who
is the owner or an admin writes it. The cadence fills in and forbids
nothing: an option made, renamed, dated or deleted by hand stays as it is.
A property may say when it shows: `config.when` is `{ "propertyId",
"optionIds" }`, one single select or sprint property of the project and a set of
its option ids, which may hold `"__none__"` for "nothing yet" as a filter's
set does. "Severity, shown when Type is Bug" is a task type as a value. The
property is drawn — in the panel, on the card, in the list — only for a task
whose value of that select is in the set. The board answer and the export
carry the rule already read: a select or an option that is gone drops out, and
a rule left with nothing reads as always shown, so a property with no `when`
always shows. Write it with `PATCH /api/properties/{id}` and `{"when":{...}}`,
or `{"when":null}` to clear it; a rule that names the property itself, a
property that is not a single select, no option it can read, or a rule that
closes a circle of properties hiding each other is a `400`; a circle that
another writer closed anyway reads as always shown.
Only a person who is the owner or an admin writes it. A hidden value never
stays: when a write leaves a property not shown for a task — a type changed,
a column moved, an option deleted, a sprint shipped, a rule written — the
task's value of it is deleted in the same transaction, and the task gets one
`value` line whose `data` carries `dropped` (the names), `propertyIds` and
`hidBy` (the option that hid them, or `null`). A value written to a property
that is not shown for that task is accepted and dropped at once. The value
route, the bulk route and the move route answer with
`dropped: [{ taskId, propertyId, name }]`, `[]` when nothing went, and
`board.mjs set` prints it. `board.mjs props` prints the rule after the
property.

`project.typeBy` on the board answer is the id of the select the project
names as its Type, or `null`: each option of it is a type, as **Settings →
Types** lists them. It is read afresh, so a deleted select reads as `null`.
It changes nothing about a rule — any select can still show a property.

Shipping a column, `POST /api/options/{id}/ship`, is a person's act and
answers a token with `403`. You see it in the feed: the lines of one ship
share one `shipId` in their `data`, and the line on the project carries the
counts. Its `action` is `shipped` for a release and `closed` for a sprint,
which archives nothing.

An agent cannot ship or unship. `shippedAt` closes a release or a sprint, so
only the owner or an admin writes it, and only as a person: a write that
carries `shippedAt` from a token is refused with `403`. An agent reads it, and
writes the other three as before.

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
{ "set": 3, "value": "…", "dropped": [] }
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

### Links, such as a pull request

A **Link** property holds a list of web addresses. Its value is a JSON list, `[]` when empty:

```bash
curl -s -X PUT $USHABTI/api/tasks/$TASK/values/$LINK_PROPERTY \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"value":["https://github.com/acme/shop/pull/12"]}'
```

The write replaces the whole list. The server keeps only `http` and `https` links, at most 20,
each at most 2000 characters, and answers `400` for anything else. It compares links without the
`#fragment` and without a trailing `/`, so the same pull request sent two times is kept once. The
answer is `{ "value": [...] }`, the list as it was stored. The server never fetches a link.

With `board.mjs`:

```bash
node board.mjs set USH-14 "Pull requests" "https://github.com/acme/shop/pull/12"   # replace the list
node board.mjs set USH-14 "Pull requests" --add "https://github.com/acme/shop/pull/13"  # add one
node board.mjs task USH-14                                                       # prints each link
```

`set` takes several links separated by commas. **`--add` reads the list and then writes it.** The
server holds no lock between the two, so two writers that add at the same moment can lose one link.
Read the task again after an add if that matters.

**Which property holds your pull request.** No setting names it. Use one rule:

1. With **one** Link property on the board, use it.
2. With **more than one**, use the one whose name says `PR` or `pull` (any case).
3. With **none**, or with several and none of them named so, write nothing: say so in the run log
   (`step --log "no Link property for the pull request"`) and put the link in a comment.

### A pull request from GitHub, with no step by hand

[`examples/github/ushabti-links.yml`](../examples/github/ushabti-links.yml) is a GitHub Actions
workflow. Copy it as it is to `.github/workflows/` in your repository. When a pull request is
opened, edited or reopened, it finds the task keys in the **title** and the **branch name**, and
for each key it runs `board.mjs set KEY "Pull requests" --add <url>`. It does not read the body:
"see USH-12" is not "does USH-12". A key is a word of its own, so `USH-123` is never `USH-12`; a
`-` may stand on either side, because a branch such as `feature-ush-12-cart` joins its words so.

It needs a board that the GitHub runner can reach, and an agent token from **Settings → People**.
Put the token in the repository secret `USHABTI_TOKEN`, the board address in the variable
`USHABTI_URL` and the project key in `USHABTI_PROJECT_KEY`. Set `USHABTI_LINK_PROPERTY` only when
the Link property is not called `Pull requests`. A key that names no task or an archived task, or a board without that
property, writes one line in the job log and does not fail the job. A board that does not answer, a token
it refuses, a write it refuses, or a variable that is not set fails the job, after the other keys
are written, so links never stop with no sign. `board.mjs` comes from a fixed
commit, so a change upstream never changes the step. A pull request from a fork gets no secrets, so
the step writes a line and does nothing.

```yaml
# Puts the link of a pull request on the Ushabti tasks it names.
# Copy this file to .github/workflows/ushabti-links.yml in your repository.
#
# Repository variables: USHABTI_URL, the address of the board, and
# USHABTI_PROJECT_KEY, such as USH. USHABTI_LINK_PROPERTY only if your Link
# property is not called "Pull requests".
# Repository secret: USHABTI_TOKEN, an agent token from Settings -> People.
name: Ushabti links

on:
  pull_request:
    types: [opened, edited, reopened]

permissions: {}

jobs:
  link:
    runs-on: ubuntu-latest
    steps:
      - name: Add the pull request to its tasks
        env:
          USHABTI_URL: ${{ vars.USHABTI_URL }}
          USHABTI_TOKEN: ${{ secrets.USHABTI_TOKEN }}
          PROJECT_KEY: ${{ vars.USHABTI_PROJECT_KEY }}
          LINK_PROPERTY: ${{ vars.USHABTI_LINK_PROPERTY || 'Pull requests' }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BRANCH: ${{ github.event.pull_request.head.ref }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          # A fixed commit, so a change upstream never changes this step.
          BOARD_MJS: https://raw.githubusercontent.com/jaklimoff/ushabti/519fef8ed92490560f1fb7e3c2560676ce39ef7a/examples/skill/ushabti/board.mjs
        run: |
          if [ -z "$USHABTI_TOKEN" ]; then
            echo "No USHABTI_TOKEN secret. A pull request from a fork gets none. Nothing written."
            exit 0
          fi
          if [ -z "$USHABTI_URL" ] || [ -z "$PROJECT_KEY" ]; then
            echo "Set the repository variables USHABTI_URL and USHABTI_PROJECT_KEY."
            exit 1
          fi
          curl -fsSL "$BOARD_MJS" -o board.mjs
          # A board that does not answer, or a token it refuses, fails the job.
          # Otherwise the links stop and nothing says so.
          if ! node board.mjs me; then
            echo "The board at $USHABTI_URL did not take the token. Nothing written."
            exit 1
          fi
          # The title and the branch only: a body says "see USH-12" as often as "does USH-12".
          # A key is a word of its own, so USH-123 is never USH-12. A branch joins its
          # words with "-", so feature-ush-12-cart names USH-12.
          keys=$(node -e '
            const pattern = new RegExp(`(?<!\\w)${process.env.PROJECT_KEY}-\\d+(?!\\w)`, "gi");
            const text = `${process.env.PR_TITLE}\n${process.env.PR_BRANCH}`;
            const found = (text.match(pattern) ?? []).map((key) => key.toUpperCase());
            console.log([...new Set(found)].join("\n"));
          ')
          if [ -z "$keys" ]; then
            echo "No $PROJECT_KEY key in the title or the branch. Nothing written."
            exit 0
          fi
          # A key with no task, an archived task, or a board with no Link property, is a line in the log.
          # Anything else the board answers fails the job, after every key is tried.
          failed=""
          for key in $keys; do
            if out=$(node board.mjs set "$key" "$LINK_PROPERTY" --add "$PR_URL" 2>&1); then
              echo "$out"
              continue
            fi
            echo "$out"
            case "$out" in
              "No task "* | *" is archived. "* | "No property called "* | "--add is for a Link property."*)
                echo "$key: the link was not added. The line above says why." ;;
              *)
                echo "$key: the board did not take the link."
                failed=1 ;;
            esac
          done
          [ -z "$failed" ]
```

## Files

A task holds files: screenshots, recordings, anything the board's list of
types takes. The bytes go to a bucket and never through the board, so an
upload is two calls around one `PUT`.

```http
POST /api/tasks/{taskId}/attachments
{ "name": "login.png", "mime": "image/png", "size": 48213 }

→ 201 { "id": "…", "uploadUrl": "https://…", "headers": { "Content-Type": "image/png" } }
```

`PUT` the bytes to `uploadUrl` within ten minutes, with `headers` and nothing
else: no `Authorization`, the URL is signed. The bucket takes exactly that
type and exactly that many bytes. Then say they are there:

```http
POST /api/attachments/{id}/ready
→ 200 { "attachment": { "id": "…", "name": "login.png", "mime": "image/png",
        "size": 48213, "width": 1280, "height": 800, "url": "/api/attachments/…" } }
```

The board checks the object before it believes you: the size, the type, and
for an image that its bytes are that image. An upload not confirmed within the
hour is removed. Only the uploader may confirm.

To show the file, put its board link in a description or a comment:

```markdown
![login.png](/api/attachments/{id})
```

`GET /api/attachments/{id}` checks that the caller is on the project and
answers `302` to a link that lasts five minutes, so the board's link is the one
to keep and to paste. An image or a video opens in place; SVG and anything
else downloads. `GET /api/tasks/{taskId}/attachments` lists a task's files,
newest first, and `GET /api/tasks/{taskId}` carries the same list as
`attachments`. The board draws the line by the file's mime from that list: an
image in place, a video as a player, anything else as a link with its size. `DELETE /api/attachments/{id}` removes one: the uploader's own,
or anybody's for the owner or an admin. An upload and a delete each write a
line of kind `attachment` to the feed, with `action` `added` or `removed`.

With no bucket on the server, every one of these answers `503`.

`board.mjs` does the three steps in one:

```bash
node board.mjs attach USH-14 login.png
![login.png](/api/attachments/5f0c…)
```

It reads the type from the name; name it with `--mime video/mp4` when it
cannot.

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

The answer is `{ "run": …, "rules": { "text": "…", "hash": "…" } }`.

`rules` is how to work on this board: Markdown that the owner or an admin
writes in **Settings → Project → Agent rules**. No field on a task is fixed, so
only the project can say which option means review, when to ask a person, what
an estimate means and what done means. **Obey it**, and read it before you set
a property. `text` is empty when the project wrote none. `hash` names the
version, and matches the `rules` line in the feed that wrote it. The claim is
the only answer that carries it — not a report, not a beat, not the board — so
keep it for the whole run. An agent cannot change it: the route answers `403`.
This is not `AGENTS.md`, which says how to work on the code of one repository;
one board can hold the work of many.

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

The stream also carries `event: presence`, which says which task a person's
browser tab has open. It is for the board's panel, not for you: ignore it, as
`board.mjs watch` does with every event name it does not know. It does not
mean that anything changed, so do not read the feed on it. An agent cannot send
one — `POST /api/projects/{projectId}/presence` answers `403` to a token —
because a run already shows what an agent is doing.

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
written on the task that gained the blocker. It also says a task was made part
of another, or taken out of it:
`data: { "action": "parented" | "unparented", "parentKey": "USH-12" }`, written
on the part. Read `action` before you read a key. A blocker going over writes no
line of its own — nothing happened to that task.

`taskId` and `taskKey` are **null** on a line about the project rather than
about a task. `reset` — the owner made somebody a reset link, with
`data: { "forUserId": "…", "forName": "Ada" }` — is one of those, and so is
`rules` — an admin changed the agent rules, with
`data: { "hash": "…", "text": "…" }`, the whole text as it was saved — so do
not read a key off every entry.

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

A page holds 200 lines unless you ask for up to 500 with `limit`. When it comes
back full, ask for the next one from its last line: that line's `createdAt` as
`after`, and its `id` as `afterId`.

```http
GET /api/projects/{projectId}/activity?after=2026-09-18T15:29:10.415Z&afterId=…
```

`after` alone is not enough. One write gives all its lines one moment, so
archiving 300 cards writes 300 lines with the same `createdAt`, and a page that
ends among them would start again at their first. Lines of one moment come in
`id` order.

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
| `{prompt}`  | What happened, the job, the path of `SKILL.md` to read, and the board's rules from the claim |
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
| `--goal`    | refine and retitle   | The job, in the prompt and on the run          |
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
node board.mjs claim USH-14 --goal "…" --plan "a|b|c"   # prints the board's rules
node board.mjs step USH-14 --index 1 --say "Writing the tests" --log "…"
node board.mjs step USH-14 --say "Running the suite" --for 45   # a long step
node board.mjs set USH-14 Status Ready     # names, never ids
node board.mjs comment USH-14 "…"
node board.mjs check USH-14 "A failed send retries five times"
node board.mjs check USH-14 "retries five times" --done   # tick it; --undone puts it back
node board.mjs describe USH-14 --file draft.md   # only if empty, or yours
node board.mjs retitle USH-14 "Retries stop after five tries"   # a title that says what it is
node board.mjs unmention USH-14            # take your own @Name out again
node board.mjs ask USH-14 "Which service owns the queue?"
node board.mjs pause USH-14                # answer a Pause, wait for Resume
node board.mjs finish USH-14
node board.mjs finish USH-14 --to "review" # hand it on; the card waits for them
node board.mjs watch --on assigned --run 'claude -p {prompt}'
```

`step` prints `control: none | pause | stop`, `pause` answers the first of
those and waits for Resume, and exit code 9 means the card was taken over.
A read that loses its connection halfway is sent once more; a write never is,
because it may have landed.
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
