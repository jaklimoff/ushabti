---
name: ushabti
description: Work on an Ushabti task board — read the board, take a task, report progress on it while you work, refine a task, set properties, comment, ask a person and close. Use whenever the person names a task key (USH-14), asks what is on the board or in the backlog, asks you to pick up, claim, refine, update or finish a task, when a prompt says the Ushabti watcher woke you, or when your work is being tracked on Ushabti. Needs USHABTI_TOKEN.
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

node board.mjs check USH-14 "Retries stop after five tries" --done
node board.mjs comment USH-14 "Tests pass. PR #124."
node board.mjs set USH-14 Status Ready
node board.mjs finish USH-14
```

Before a step you know is long — a build, a whole test suite, a wait for
somebody — say how long the next word takes:

```bash
node board.mjs step USH-14 --say "Running the whole suite" --for 45
```

The board then waits forty-five minutes for your next report instead of
thirty, and closes the run as lost only after that. Sixty minutes is the most
it grants, and your next `step` puts the ordinary thirty back. The heartbeat
cannot do this: it says the process is alive, never that the work moves.

`--say` is the line on the card. Write it for a person reading the board over
your shoulder: "Writing the tests", not "invoking tool". `--index` counts from
zero and marks everything before it done. `--log` is the transcript line in the
panel; leave it out and the `--say` line is logged instead.

`check` adds a checklist item, and `--done` ticks the one that text names —
the whole text, or one part of it that fits only that item; `--undone` puts it
back. It refuses to guess, and lists the items instead.

`node board.mjs archive USH-14` takes a task off every board and list and keeps
its history, its comments and its link; `restore` puts it back. Archive is how
a task that is over goes away — say _archived_ and _put back_, never "closed"
or "done", which are words of the owner's Status property. Deleting a task is
for a mistake, and an agent does not delete.

## When the watcher woke you

If `USHABTI_RUN` is set, you did not start this work: `board.mjs watch` did,
because a task was created, assigned to you, mentioned you, or answered a
question you asked. `USHABTI_TASK` is the task key and `USHABTI_EVENT` says
which of those it was.

- **The task is already yours.** The watcher claimed it and beats for you. Do
  not `claim`, and do not start `beat`.
- **Read it first**: `node board.mjs task $USHABTI_TASK`. On a `reply`, the
  newest comments hold the answer.
- **Report with `step`** as usual, and obey `control` as usual.
- **End with `finish`, or with `ask`.** Either ends your session. If you just
  stop, the watcher closes the run for you, but the card then says less than
  you could have.

## Refining a task

A person wrote a title in a hurry. Make it something a developer or another
agent can start without asking anything.

1. **Read the board's properties** with `props`, and the task with `task`.
2. **Set only what you are sure of.** A label the title names, an estimate the
   work makes obvious. Leave a property empty rather than guess. Never set a
   person property: who does the work is the people's decision.
3. **Write the acceptance criteria as checklist items**, one `check` each. A
   criterion is a thing somebody can test: "A failed send retries five times",
   not "Retries work".
4. **Write the description, or propose one.** If it is empty, `describe` it:
   what is wanted, why, what is out of scope, and where in the code it lives if
   you can find out. If a person already wrote one, do not write over it —
   `describe` refuses anyway. Post your version with `comment --file`, and the
   person can make it the description with one press.
5. **If you cannot go on without an answer, `ask`**, and stop. One question,
   the one that matters, answerable in a sentence. Do not ask what you could
   find out by reading the code.
6. **`finish`**, with a `--log` line that says what you added.

Keep it short. A refined task is one a person reads in a minute.

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
  - `pause` → `node board.mjs pause USH-14`. It tells the board you stopped,
    waits, and returns `resumed` when a person presses Resume. If it returns
    `still paused`, run it again. If it prints `control: stop`, finish with
    `--status stopped`. Exit code 9 means the card is not yours any more.
- **Exit code 9 means the card is not yours any more.** Somebody pressed Take
  over or dragged the card. Stop work, do not re-claim it, tell the person.
- **One open run per task.** Claiming a held task fails with 9. Pick another.
- **Never invent a property or an option.** Run `props` to see what this board
  has, and use the names. `set` refuses an unknown one and lists the real
  choices. Status, Priority and the rest belong to the board's owner, who may
  rename or delete any of them — that is the point of the product.
- **Do not create properties or delete tasks.** You may create tasks, edit
  them, comment and move them.
- **Do not write over a person's description.** Propose yours in a comment.
- **A question is a comment and a wait.** `ask` posts the question, marks the
  run as waiting and tells you to end the session. The board does not close a
  waiting run for silence, and the watcher wakes you when a person answers.

## When the work has no task yet

```bash
node board.mjs new "Fix the offline queue" --set "Status=Todo" --set "Priority=High"
```

Then claim it as usual. Prefer an existing task if one already describes the
work.

## Waiting for work

A harness answers a prompt and exits, so it cannot wait for the board by
itself. `watch` does the waiting, and starts one harness session per piece of
work. The person who runs the agent starts it once and leaves it running:

```bash
node board.mjs watch --on assigned,mention \
  --run 'claude -p {prompt} --allowedTools "Bash(node:*)"'
```

`{prompt}` says what happened and points back at this file, so any harness
that takes a prompt and exits works. While it runs, the board shows the agent
as listening. You never run `watch` from inside a session.

## The rest of the API

`docs/agents.md` in the Ushabti repository has the raw HTTP calls, the errors
and what a run is. Read it only if `board.mjs` cannot do what you need.
