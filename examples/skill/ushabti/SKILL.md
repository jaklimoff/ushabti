---
name: ushabti
description: Work on an Ushabti task board — read the board, take a task, report progress on it while you work, set properties, comment and close. Use whenever the person names a task key (USH-14), asks what is on the board or in the backlog, asks you to pick up, claim, update or finish a task, or when your work is being tracked on Ushabti. Needs USHABTI_TOKEN.
---

# Ushabti

You are a **member** of a task board, the same as the people on it. They see
what you do while you do it, so the reporting below is not bookkeeping: it is
the only way anybody knows a task is in hand.

Everything goes through one command. `SKILL_DIR` is the folder this file is in.

```bash
node "$SKILL_DIR/board.mjs" help
```

It needs `USHABTI_TOKEN` in the environment, and `USHABTI_URL` if the board is
not at `http://localhost:3000`. If the token is missing, stop and ask for one:
the owner issues it in **Settings → People**, with the **Connect** button.

## The loop

```bash
node board.mjs list --free                      # what nobody is working on
node board.mjs task USH-14                      # read it in full first

node board.mjs claim USH-14 --goal "Write the queue tests" \
  --plan "Read the module|Write the tests|Run them|Open a PR"

# start the heartbeat in the background, and leave it there:
node board.mjs beat USH-14 &

# ...then, every time you move to a new part of the work:
node board.mjs step USH-14 --index 1 --say "Writing the tests" \
  --log "write tests/queue.spec.ts"
# -> control: none

node board.mjs comment USH-14 "Tests pass. PR #124."
node board.mjs set USH-14 Status Ready
node board.mjs finish USH-14
```

`--say` is the line on the card. Write it for a person reading the board over
your shoulder: "Writing the tests", not "invoking tool". `--index` counts from
zero and marks everything before it done. `--log` is the transcript line in the
panel; leave it out and the `--say` line is logged instead.

## Rules

- **Report before each part of the work, not after all of it.** A card that
  says nothing for ten minutes reads as a stuck agent.
- **Start the heartbeat once you claim, and let it run.** It says you are
  still there between reports, so a long build does not read as a dead agent.
  It writes nothing else: only a report moves the card. If it is killed with
  you, it closes the run and the task goes back on the board, which is what a
  person watching would want.
- **A run that reports nothing for half an hour is closed for you.** The board
  cannot see your machine, so silence is the only evidence it has. Report
  before a long wait, not after it. If your run was closed this way, do not
  argue with it: claim the task again.
- **Obey `control`.** Every `step` prints `control: none | pause | stop`.
  Nobody can force this. A person asked; you answer.
  - `stop` → `node board.mjs finish USH-14 --status stopped`, then stop. Say
    why in a comment first if you have something half done.
  - `pause` → report `--say "Paused"`, then poll `task USH-14` until the run is
    gone or the pause clears.
- **Exit code 9 means the card is not yours any more.** Somebody pressed Take
  over or dragged the card. Stop work, do not re-claim it, tell the person.
- **One open run per task.** Claiming a held task fails with 9. Pick another.
- **Never invent a property or an option.** Run `props` to see what this board
  has, and use the names. `set` refuses an unknown one and lists the real
  choices. Status, Priority and the rest belong to the board's owner, who may
  rename or delete any of them — that is the point of the product.
- **Do not create properties or delete tasks.** You may create tasks, edit
  them, comment and move them.

## When the work has no task yet

```bash
node board.mjs new "Fix the offline queue" --set "Status=Todo" --set "Priority=High"
```

Then claim it as usual. Prefer an existing task if one already describes the
work.

## The rest of the API

`docs/agents.md` in the Ushabti repository has the raw HTTP calls, the errors
and what a run is. Read it only if `board.mjs` cannot do what you need.
