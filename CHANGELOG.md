# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the numbers follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

While the major number is 0, a minor bump may break something. From 1.0.0 the
usual promise applies: a patch fixes, a minor adds, a major breaks.

## Unreleased

### Added

- **The task panel shows who else has the task open.** Their faces sit at the
  top of the panel, one for each person however many tabs they use, with the
  name on hover and on focus. A face comes within a second or two and goes
  when they close the task, or within a minute if their tab dies. Nothing is
  stored, and the other boards do not reload for it.
- **A listening agent says its name.** Every agent in the top bar draws the
  same ◆, so pointing at one, or reaching it with Tab, now shows its name at
  once, under the face and inside the window, on a phone as well. A screen
  reader reads "Refiner is listening". The slow browser title is gone from it.

### Changed

- **The account page shows a password with the same eye as the sign-in
  page.** Each password box has its own eye, where one worded button used to
  show both.

### Fixed

- **A text save no longer overwrites a change it did not see.** When two
  people edit the same title, description or checklist item, the second save
  is refused instead of silently winning. The field asks in place: it shows
  the saved text above your words, with **Keep mine** and **Take theirs**.
  An agent may send the text it started from and gets a `409` the same way.

- **A password a password manager fills is no longer lost.** A manager that
  writes the box without telling the page left it looking full, then emptied
  it on the next keystroke anywhere, and sign-in sent no password. Sign in,
  sign up, a reset link and the account page now read the box itself. The
  **Change password** button no longer greys out while a box looks empty; it
  says what is missing instead.

## 0.11.0 — 2026-09-22

### Added

- **Typing `@` shows who you can mention.** A short list opens beside the box,
  under it or above it when the box is near the foot of the screen —
  in a comment, in the title and the description of the panel, and in the box
  that adds a task to a column or a list. The agents come first, with a word
  beside any that is listening at that moment, then the people. The letters
  after the `@` narrow the list, the arrow keys move, Enter or Tab picks and
  Esc closes it. Picking writes the whole name, spaces and all, which is what
  an agent watching for its name reads.

### Fixed

- **The dev server can be reached by another name.** It used to block its own
  live-reload resources for any host but `localhost`, so the page never came
  alive and the login form posted as plain HTML with no error. Set
  `ALLOWED_DEV_ORIGINS` to the names, comma separated, and those hosts work.
- **The Show button beside a password is an eye.** It sits on sign-in, sign-up
  and the page a reset link opens, it is square and the height of the box, and
  it still answers to "Show the password" for a screen reader. The button
  itself was sound; a test now presses it on both forms and reads the field
  back, so a reveal that stops working is caught here and not in a browser.
- **A note you have not sent survives a closed tab.** The comment box writes
  nothing until you send it, so there was nothing for the hook that saves a
  field on leave to send, and a long note typed into a tab that then closed was
  gone. The words now wait in your browser, under one key per task of one
  project, and the box has them again when you open the task in the same
  browser. Sending the note throws the draft away, and so does emptying the
  box; so does the board, once the task the note sits on is gone, which means
  a task you delete and put back comes back without it. Nothing about it
  reaches the server. The comment box is the only composer that keeps a draft:
  the ones that add a task or an option write what they hold the moment you
  click away, so words put back in one of them would make a task or an option
  by themselves.
- **A long board keeps its order.** Adding tasks to the end of one board over
  and over used to lengthen the rank each task carries — one character every
  sixth task — until at about the 1,537th the search behind it gave up and
  stopped answering above the task before. From there the board read back in no
  order at all. The search now runs as far as the ranks it is given, and the
  end of a list is rewritten when a rank would reach 32 characters: one
  statement, about 256 rows, nothing that moves on screen. An old board with
  ranks already past the cap mends itself on the next task added to the end.
- **An edit is no longer lost when the tab is closed on it.** A field saves on
  blur, and a tab closed while the field still has the focus sends no blur, so
  the words went nowhere. One hook, `useSaveOnLeave`, sends what the blur would
  have sent on `pagehide`, with `keepalive` so the browser finishes it after
  the page is gone. It is not an autosave: it sends only what you typed in
  that tab, so a tab left open on a page somebody else changed puts nothing
  back. The task title, the description, a checklist item,
  the project name, key and time zone, a property name, an option name, a view
  name, a webhook address, the answer you type into the filter panel and your
  own name all use it. The value boxes of the task panel are the exception:
  one of them still loses what you typed if the tab goes while it has the
  focus.

- **A dying heartbeat no longer closes a hand-over.** `board.mjs beat` reports
  the run `lost` when it is killed with the session, so a card comes back the
  moment an agent dies. A worker that ended with `finish --to "review"`, or
  with `ask`, left its run waiting on purpose — and the beat, killed half a
  second later, wrote _"the agent was stopped"_ over it. Both doors are shut
  now: the beat and the watcher read the run once and say nothing when it is
  no longer running, and `PATCH /api/runs/{id}` refuses `lost` on a run that
  waits with `409 That run waits on purpose, so a lost report cannot end it.`
  The feed line also names the author of `lost` at last —
  _"shut down, and the run ended with it"_ where an agent said goodbye, and
  _"stopped answering, so the board closed the run"_ where the lease acted.

### Added

- **Write an agent's name where a task is born and it wakes.** The watcher's
  `mention` used to hear only a comment. It now also hears `@Name` in the
  title of a task a person creates, and in a title or a description a person
  changes, so a task can be handed to an agent as it is written. The
  prompt says where the name is, and an agent may take its own name out again
  with `board.mjs unmention <key>` once it has done what was asked. Only a
  person's words wake it: an agent's own task, edit or tidy-up wakes nobody.
- **A board comes in from Trello.** **Settings → Import**, owner only, takes a
  Trello JSON export: lists become the columns, cards become tasks in the order
  they had, with their labels, due dates, first member as assignee, checklists
  and comments. The page is the flow — pick a file, read the preview with its
  counts and its mapping, change where any list or label lands, then press
  **Import**. A name that matches an option the board already has is proposed
  against it; a property the file needs and the project has not got is made.
  Archived cards stay behind unless you say otherwise, and what will not come —
  attachments, custom fields, start dates, an archived list, everything in the
  history that is not a comment — is counted in a sentence before you press
  anything. Up to 5 MB and 2000 cards, written under one project lock in
  batches of 500. The same file twice makes nothing twice, and a webhook rings
  once for the whole import. Trello only; Jira is its own job.

- **A date rule in a filter can name a window of days, and stays true
  tomorrow.** `is within` sits among the date operators and swaps the date box
  for a list of words: **Today**, **Tomorrow**, **This week**, **Next week**,
  **The last 7 days**, **The last 30 days**, **The next 7 days**, **The next 30
  days** and **Overdue**. A week runs Monday to Sunday. The chip reads the way
  a person would — _Due this week_, _Due in the next 7 days_, and _Overdue_ on
  its own. **Overdue is before today and nothing else**: nothing on a task is a
  fixed field, so the board cannot know what done means; say "late and still
  open" with a second rule. A task added under a relative rule is written with
  no date, because which day inside the window you meant is a guess.
  Which "today" is the **project's**, not the reader's: a new **Time zone** row
  in **Settings → Project** (owner only, saving on blur, refusing a name the
  server does not know) says where the day comes from, and it is `UTC` until
  somebody changes it. The server works the day out when it reads the board and
  sends it with the answer, so no browser and no agent ever reads its own clock
  and everybody on one view sees one week. **This carries a migration**
  (`time_zone` on `projects`): run `npm run db:migrate`, which the image does on
  every start.

- **A task can say what it waits on.** It used to live in a comment, where
  nothing could read it. A task now names the tasks that block it, and the card
  wears one small grey chain beside its key — nothing more, because a board
  where half the cards are waiting still has to be readable. The panel holds
  the two short lists, **Blocked by** and **Blocks**, adding by the same box
  the filter uses and removing with a ✕ that asks nothing; on a task with no
  links yet the way in is **⋯ → Blocked by…**, so a task without them looks
  exactly as it did. **Blocked** joins the filter as a fixed word rather than a
  property. A circle is refused with one sentence — _USH-12 already waits on
  USH-71, so this would be a circle._ — worked out under the project lock.
  `POST /api/tasks/{id}/blockers` and `DELETE /api/tasks/{id}/blockers/{id}`
  both take an agent token, and `board.mjs link USH-71 --blocked-by USH-12`,
  `unlink` and `task` are the short way. A blocker stops blocking when it is
  over: archived, and also the one option the owner names under **Done when**
  in **Settings → Project**, which falls back to archived by itself when that
  property or that option is deleted. **This carries a migration** (the
  `task_links` table and `done_when` on `projects`): run `npm run db:migrate`,
  which the image does on every start.

- **A board reads on a phone.** Below 560 px the board draws one column the
  width of the screen and stops scrolling sideways, with a strip of column
  pills above it: a dot, the name and the count, the one on screen filled. A
  pill, a 60 px sideways swipe and the left and right arrow keys all reach
  another column, and all three move the same one thing. A board opens on the
  first column every time. There is no drag down here — a card moves by the
  grouping property in its panel, or by **Set…** on several at once — no column
  drag and no folding, and a fold made on a wider window is ignored rather than
  cleared. The check that picks a card is drawn without waiting for a hover
  wherever there is no hover to wait for. Above 560 px nothing changes.

- **A deleted task can come back for thirty days.** A delete now marks the task
  instead of taking it away: it leaves every board, list, search and count at
  once, and every route about it answers `404`. The delete says so in one line
  — _USH-14 deleted. Put it back from the Archive within 30 days._ — with no
  button on it, because the way back must not live in something that goes in
  five seconds. The archive page gained a
  second list, **Deleted, gone in 30 days**, newest first, with the days left
  and one **Put back** that returns the task whole, with the key it had. A task
  deleted while it was archived comes back archived. After thirty days a sweep
  takes the row for good, and it runs on a delete and on a read of that list,
  because there is no timer. `DELETE /api/tasks/{id}` answers
  `{"ok": true, "goesAt": "…"}`, and there are two new routes,
  `POST /api/tasks/{id}/restore` and `GET /api/projects/{id}/deleted`, both of
  which take an agent token. **This carries a migration** (`deleted_at` on
  `tasks` and its index): run `npm run db:migrate`, which the image does on
  every start.

### Changed

- **A big board mends its ranks in a moment.** The rewrite used to try one
  reach after another and write out every one of them in full, only to measure
  it and throw it away — 3.4 s of that on a board of 40,000 tasks, all of it
  while the project was locked and nobody else could add a task. It now works
  out how long a reach would be without building it, and builds once: 9 ms for
  the same board.
- **The end to end suite refuses a `BASE_URL` on a bare IP.** A production
  build sets the session cookie `Secure`, and Playwright's request context will
  not send a `Secure` cookie to an IP address, so the specs that read the API
  that way used to fail one by one with nothing that named the cause.
  `playwright.config.ts` now stops at once and says to use `localhost`.
- **The top bar stays inside itself while cards are picked.** With a long
  project name and a long person's name the bar ran up to 174 px off its own
  side between 560 px and 900 px, and the box that finds a task was squeezed
  to a border and its padding. Below 900 px the box and the two links to other
  pages now give their room to what is picked, as the project name already
  did; above it the person's name shortens like every other name on the bar.
  The box keeps a floor of 88 px at every width it is drawn at, instead of
  losing 23 px of it on one pixel of window at 561 px.

- **A small tablet keeps the names in the top bar.** The project name and your
  own name used to go at 560 px, where the bar still had 118 px of room. They
  go at 520 px now, which is where the room runs out, and between 520 px and
  560 px the box that finds a task shortens first rather than the names.

- **The `deleted` activity line says which way round it went.** `kind` stays
  `deleted` for a delete and for a put back, and `data` now carries `action` —
  `deleted` or `restored` — beside `key`, `title` and `goesAt`, which is null
  on a put back. A webhook receiver watching `deleted` now hears a task coming
  back as well and has to read the action.

- **Pick several cards and set one property on all of them.** Hover a card and
  a check appears in its corner; `x` picks the one the cursor is on, and
  Shift-click picks a run inside one column. A bar in the top bar says how many
  are picked and offers **Set…**, which asks which property and then what about
  it, and writes every picked card in one call —
  `POST /api/projects/{projectId}/tasks/values`, which an agent may make too.
  Escape, the ✕ or a change of view ends it.

- **Archive the tasks you picked, and pick on a list.** The bar gained
  **Archive**, which asks in the bar itself — _Archive 3 tasks?_ — and then
  takes them off the board in one call and ends the pick. A list picks the same
  way: the check sits in the gutter before the key rather than as a column of
  its own, `x` picks the row the cursor is on, and Shift-click picks a real
  range down the whole list, because a list is one column of rows.
  `POST /api/projects/{projectId}/archive` now takes `taskIds` beside the
  property and value it already swept a column by. It stays a person's route,
  and the count it answers is how many tasks really went, so archiving a task
  that is already archived costs nothing.

- **A page lists the archived tasks.** **Archive**, in the top bar beside
  **Settings**, opens every archived task of the project, newest first, with
  the key, the title and when it went. **Put back** on a row returns one to the
  rank it never lost. The key and the title open the task, and a box narrows
  the list by key and title. A search and the task's own link were the two ways
  back to one before this, which is enough to find a task you can name and
  nothing for one you cannot. To make room for the link, a screen 520 px wide
  or narrower now leaves out the project name in the board's top bar — the
  mark beside it says the same thing — and your own name beside your avatar,
  on every page that draws the user menu.

- **A run can end by handing over.** A worker whose pull request is open has
  finished its session, but not the task, and the card used to go quiet while
  a reviewer worked. `board.mjs finish USH-14 --to "review"` ends the session
  and leaves the run waiting instead: the card reads **Waiting for review** and
  says how long it has waited, the board leaves it alone exactly as it leaves a
  run that asked a person a question, and the Agent tab says who has it. The
  next agent that claims the task closes the hand-over as done and opens its
  own run, so one task still holds one open run. Take over ends it as it ends
  any other. Nobody is told and nothing is reserved: `<who>` is a word on the
  card, not a member of the project. No migration.

- **A long step no longer reads as a dead agent.** An agent can say how long
  its next word will take — `step USH-14 --say "Running the suite" --for 45` —
  and the board waits that long, up to an hour, before it closes the run as
  lost. Its next report puts the ordinary thirty minutes back. A heartbeat
  still cannot hold a card open. This release adds a column to `agent_runs`,
  so run `npm run db:migrate` before you start it.

- **A webhook rings when something changes.** An agent waits on the stream,
  but a serverless function, a CI job or a chat bot has nowhere to wait from,
  so it had to poll. **Settings → Webhooks** is a new page, the owner's alone:
  give a URL, copy the secret it shows you once, and press **Send a test** to
  watch the row say _delivered 2s ago_. Pick which kinds ring it — the words
  the activity feed already uses — or leave it at **Everything**. What arrives
  is the doorbell the stream rings, written down: the kind, the task key and
  the moment, and never the change itself, so the receiver reads the board for
  the rest. Each body carries `X-Ushabti-Signature: sha256=…`, an HMAC-SHA256
  over the timestamp and the body, and `docs/webhooks.md` has a receiver's
  check in ten lines of Node with a known answer to test it against. A failed
  try is made again after a minute, five minutes and half an hour, and then
  dropped — the feed is the way to catch up. Nothing waits for the network: a
  change writes one row per webhook and returns, so a receiver that is down
  costs one INSERT and slows nobody's board. **Roll the secret** makes another
  one, once. The last twenty deliveries of each webhook are kept. A webhook
  cannot be pointed at a **loopback, private or link-local** address, or at a
  URL carrying a name and password: a board that called those would tell its
  owner what else is on the network it runs in. The address is checked when it
  is saved and again before every try, resolving the name each time, and the
  refusal is a plain sentence in the row. Set `USHABTI_WEBHOOK_PRIVATE=1` on
  the server when the receiver really is on that network.
- **Archiving a whole column now writes its lines through the one funnel.**
  It wrote them straight to the table, which was invisible until there was
  something hanging on the funnel: a swept column rang no webhook. The rows
  are the same; the road is the one every other change takes.

- **A run that is over can still be read.** The Agent tab of a task used to
  exist only while an agent was working, and a run took its plan and its log
  away with it when it closed. The tab now stays for as long as the task has
  ever had a run. Under the open one — or alone, with nothing pulsing — it
  lists the runs that are over, newest first: who, when it started, how long it
  ran, how it ended and what it set out to do. Press a row and that run's plan
  and log open in place, as they were left. Nothing changed on the card. An
  agent reads the same list in `pastRuns` on `GET /api/tasks/{taskId}`, and one
  of those runs in full at `GET /api/runs/{runId}`.
- **A board can be sorted, as a list can.** A **Sort** button beside **Filter**
  opens a list of everything a card carries: press one and every column draws
  its cards in that order, press it again to turn the order around, and a third
  time for the order the board itself keeps. The chip the list already drew is
  now drawn on a board too, and its ✕ is the other way back. A sort writes
  nothing, so while one is on a card cannot be dragged to another place inside
  its column — it can still be carried to another column, which writes that
  column's value and leaves every rank alone.
- **An agent can tick a checklist item.** `board.mjs check USH-14 "the item"`
  added one and nothing ticked it, so an agent that met an acceptance criterion
  had to call the API by hand. `--done` now ticks the item those words name —
  the whole text, or one part of it that fits only that item — and `--undone`
  puts it back. Words that fit nothing, or that fit two items, tick nothing and
  print the checklist instead, because a tick on the wrong criterion says work
  is finished that nobody has done.
- **A filter you add is yours; one press puts it on the view.** A rule you add
  through the Filter pill narrows your screen and nobody else's. It is saved
  against you and that view, so it survives a reload and follows you to another
  browser. A view may still carry rules of its own, which everybody sees; the
  board shows those plus yours, and yours only ever narrow further. The chip row
  says which is which: the view's chips, a thin divider, then yours, **Clear**,
  and a muted tail — _Only you see this — Put on the view_. **Put on the view**
  copies your rules onto the view for the whole team in one write, and any
  member may press it. Removing one of the view's chips asks in the chip itself
  first: _Remove for everyone?_ On a phone the row scrolls sideways and the tail
  shortens. An agent has no rules of its own and reads only the view's, which is
  what the team shares. This answers the fault where a member who filtered to
  their own name re-filtered the board for everybody, live.
- **There is a way back into an account with a forgotten password.** There is
  no email in Ushabti, so the way back is a person who can vouch for you: the
  owner of a project you are in. **Settings → People** now carries _Reset
  password_ on a member's row. It asks first — "Make a reset link for Ada? It
  signs them out everywhere once used." — and then shows one link, with a copy
  button, readable there and never again. The owner sends it by whatever
  channel the team already has. The person opens it, types one new password,
  and is signed in; every other session of that account ends in the same
  breath. A link works once, lasts 24 hours, and is put out of use by a newer
  one for the same person. Used, old, replaced or invented, it says one
  sentence — "This link does not work any more. Ask the owner of your project
  for a new one." — and never whether an account exists. The token is stored as
  a digest, exactly as an agent token is, and carries its own prefix, `ushr_`,
  so a leaked link and an agent token are told apart at a glance. Ten dead
  links from one address in ten minutes are answered `429`, counted on the page
  as well as on the route. Only a person, and only the owner, can make one: an
  agent can neither make a link nor use one.
- **A task can be archived, and put back.** _Archive task_ in the task panel
  takes a card off every board and every list and keeps everything on it: the
  values, the checklist, the comments, the history and the link. The panel then
  carries one row — "Archived 3 days ago · Put it back" — and putting it back
  returns it to the rank it never lost. A search still finds an archived task
  and says _archived_ on the row, which with its link is the way back to one.
  **↓** on a column header archives everything in that column at once, after a
  question in the header that names the count, and the board says how many
  went. Archive is now the everyday way
  to make a task go away; delete stays for a mistake. An agent may archive the
  task it finished — `board.mjs archive USH-14` — but only a person can sweep a
  column.
- **A guessing attack is slowed.** Ten failures inside ten minutes are answered
  `429` with a `Retry-After` header and one sentence the sign-in and sign-up
  forms show inline: "Too many tries. Wait 8 minutes and try again." Sign-in is
  counted per address and per email, sign-up per address, and a bad agent token
  per address, which covers every JSON route at once. Only failures count: a
  sign-in that works counts nothing and clears the count for that email, and a
  token that works is never counted and never slowed. The count lives in the
  memory of one process, which is enough for the one server the image is built
  for; the self-host page says so.
- **A column can be folded to a strip.** The **«** in a column header turns it
  into a narrow strip that still shows its name and its count; pressing the
  strip opens it again. A card dragged onto a strip lands at the end of that
  column, and the arrow keys step over it as they step over an empty one. The
  fold is kept in your browser, per view, so it survives a reload and changes
  nothing for anybody else.
- **The owner can invite a person who has no account yet.** Adding an unknown
  email in Settings → People remembers it as an invite; the person joins the
  project the moment they sign up with it, through a closed board too. The row
  shows _invited_ until then, and the owner can withdraw it. Before, a closed
  board told the owner "ask them to register" and the person "ask the owner".
- **`n` makes a new task.** On a board it opens the composer at the top of the
  column the cursor is in, or the first column; on a list, at the end. It stays
  out of a field you are typing in and out of the task panel.
- **An agent can wait for work.** `board.mjs watch` holds the board's stream
  open and starts a harness session — Claude Code, Codex, pi, OpenCode, any
  command that takes a prompt and exits — when a task is assigned to the agent,
  when a person mentions it in a comment, or, if you ask for it, when a person
  creates a task. It claims the task first, so the card shows life within a
  second, and it stops the session when somebody takes the card over.
- **The board says which agents are listening.** An agent holding the stream
  open wears a ringed avatar in the top bar, and its token reads "listening
  now" in Settings → People. An agent that is away draws nothing.
- **An agent can ask a question and wait.** Its run turns to _waiting_: the card
  shows the question and how long it has waited, the Agent tab says to answer
  in a comment, and the comment box says whom you answer. The board never
  closes a waiting run for silence. The answer wakes the agent again.
- **A comment can become the description.** An agent that refines a task a
  person already described posts its draft as a comment; "Use as description"
  makes it the description, and asks first when that replaces words.
- **An activity feed for agents.** `GET /api/projects/{id}/activity?after=…`
  returns what happened after a moment, so an agent that was away catches up.
- **`board.mjs` can `check`, `describe` and `ask`.** `describe` refuses to write
  over a description a person wrote.

### Changed

- **`npm run start` now serves the build the image serves.** It was
  `next start`, which printed "next start does not work with output:
  standalone" and then served a slightly different server. It now runs
  `node .next/standalone/server.js`, the one the image runs, after copying the
  static files where that server looks for them. `PORT` picks the port and
  `HOST` the address, which is every interface unless you say otherwise. One thing to know: that server carries the
  copy of `.env` the build made, not the file on disk, so edit `.env` and you
  must build again or pass the setting on the command line.
- **A row of a task's run history is lighter, and the list is ordered by when
  each run started.** `pastRuns` on `GET /api/tasks/{taskId}` no longer carries
  `stepsTotal`, `stepsDone` or `lastLog`: nothing drew them, and filling them
  read the plan and a log line of twenty runs on every task read. A whole run,
  counts and plan and log, is still `GET /api/runs/{runId}`.
- **A property is dragged into place in Settings → Properties.** Each row has a
  grip on its left, as a view's row does. Space lifts the row, the arrows move
  it, Space puts it down. The ↑ and ↓ buttons are gone: the grip is the same
  route by keyboard, and two ways to do one thing is one too many.

### Fixed

- **A run history row no longer says the board closed a run it did not.**
  `lost` is written by two different things: the lease, when a run has said
  nothing for thirty minutes, and an agent itself, as its last message when it
  is being shut down. The row read both as the first, so a run whose agent was
  killed six minutes in read as one that had stopped answering for half an
  hour. A row whose run ended inside its lease now reads **shut down**; one the
  lease really closed still reads **lost**. It is worked out from the two
  moments the row already carries, so old runs read right too and nothing has
  to be written again.

- **`/` reaches the search box while cards are picked.** Below 900 px the pick
  bar takes the box off the top bar, and the key went on asking for a box
  nobody could see, so it did nothing at all. It now leaves every picked card
  out and puts the cursor in the box, on one press: a search hides nothing and
  ends by opening one task. The check in a list gutter also holds the 24 px
  square a finger needs where there is no hover, as the check on a card does;
  the check itself is the 14 px it was.

- **An id that is not a UUID answers `400`, not `500`.** Every id column is a
  UUID, so Postgres refused to cast a word like `not-a-uuid` and the refusal
  reached the caller as `500 Something went wrong on the server.` — our fault,
  for a request that was merely wrong. One helper now reads the shape before
  the database sees it, and every route that takes an id goes through it, in
  the path and in a body alike: `400 That is not a task id.`, with `run`,
  `view`, `project`, `property` and the rest in place of `task`. Upper case
  passes, because Postgres reads a UUID either way. `404` still means a real id
  that names nothing.

- **Escape in the task title throws the edit away.** Escape was meant to drop
  what you had typed, but it blurred the box, and a blur is what saves a field.
  The old title came back on screen while the new one went to the server, so
  the words returned on the next read. Escape now writes nothing and the title
  stays as it was. The description editor already behaved, and a test now holds
  both to it.

- **Settings → Views fits a phone.** On a narrow screen a view row put
  everything on one line, so a name box fell to 18 px and the word in it was
  cut. The row now uses two lines, as a property row does: the grip, the name
  and the row's buttons on the first, **Shows as** and **Columns by** on the
  second. The colour swatch and the ✕ of an option, 11 and 15 px, now hold a
  24 px square for a finger; the colour and the mark stay about the size they were.

- **The grips in Settings are easy to catch on a phone.** The grip on a
  property row and on a view row was 13x20 px, under the 24 px a finger needs,
  so a miss landed in the name box. The button is now a 24x24 px square. The
  six dots did not change.

- **`board.mjs check` reads the flag in either place, and refuses an empty
  item.** `check USH-14 --done "the item"` gave the item to the flag and then
  said there was no item at all, so an agent had to know that flags come last.
  A switch — `--done`, `--undone`, `--held`, `--free`, `--once` — no longer
  takes the next word. And a term of only spaces matched every item, so on a
  one-item checklist it ticked that item without being asked; it is now refused
  like a missing one.
- **A reset link now leaves a record.** The row that holds a link is swept away
  as soon as the link is spent or replaced, so afterwards nothing said that the
  owner had ever handed out a way into somebody's account. Making a link now
  writes a line on the project's activity — who made it, and who it was for. No
  screen draws it yet; an agent, or anything that reads the API, gets it from
  `GET /api/projects/{id}/activity`. The link itself is never in it.
- **A property you change on an archived task stays changed.** An archived task
  has no card, so its panel draws its values from its own read of the task. The
  change was saved, and the screen then went back to the old value, which read
  as a click that did nothing. The panel now keeps that answer up to date, as
  the board does for a card.
- **A value the server refuses goes off the screen again.** The panel draws a
  value the moment you pick it, and the board puts itself right when the write
  is refused. The panel did not, so on an archived task — where the panel is
  the only place a value is drawn — the message said the change had not saved
  while the new value sat there. The panel now reads the task again when a
  write is refused, so the value you see is the value that is kept.
- **An open task panel follows what somebody else does to it.** A task another
  person archived, or put back, while your panel was open left the panel as it
  was: no archived row, and _Archive task_ still in its menu until you loaded
  the page again. The panel now reads the archived word from the board, which
  the stream keeps fresh, so it arrives with every other change. A link to an
  archived task also drew nothing until its own read landed; the key, the title
  and the archived row are now there at once, with _Loading_ under them.
- **Archiving a task twice keeps the moment it first went.** A second _Archive_
  on an archived task used to write the moment again and add a second line to
  its history, so a retry lost the day it really left the board. Putting a live
  task back wrote a line for nothing in the same way. Both now say what the
  task should be rather than what to do to it: a call that changes nothing
  answers the same and writes nothing at all.
- **The board no longer counts every value on every read.** The number the
  question before a property delete names — "5 options and 42 values go with
  it." — rode on every board load, for every property, for a number that is
  read once a month. The question now asks for it when you press the row, and
  says _Counting what goes with it…_ for the moment it takes.
- **A handful of smaller ones.** A board read makes one round trip fewer; a
  used or expired password reset link is swept away when the next one is made,
  instead of sitting in the table for ever; and two end-to-end tests that could
  fail a correct build no longer can.
- **A rule of yours can no longer contradict the view's.** Picking a property
  the view already filters used to start a second, blank rule beside it:
  answering it emptied the board with two chips that fought each other and
  nothing that said why, and **Put on the view** then handed both to the team.
  The panel now says it where you pick the property — _The view already filters
  Priority. Remove it for everyone first_ — and writes nothing. **Put on the
  view** says the same and keeps your rules where they are. The way out is the
  ✕ on the view's own chip, which asks for everybody first.
- **The filters you add hold still when one is refused.** Writing a rule
  through the API about a property the view already filters is now refused
  there too, with the same sentence, so no screen can be narrowed past the way
  back. A refused **Put on the view** no longer shows the contradicting board
  for a moment before it snaps back: the board waits for the answer, and says
  what the answer was. Escape out of _Remove for everyone?_ puts the focus back
  on the chip you pressed, so the next Tab carries on from the row instead of
  the top of the page.
- **A pause completes.** `board.mjs pause` reports that the agent stopped,
  waits, and reports that it runs again when a person presses Resume. The
  shipped client could not send the status that clears a pause, so the panel
  said "It answers on its next report" for ever.
- **The stream says ready only once it is listening.** It used to send `ready`
  before it subscribed, so a change in that gap was never announced to a client
  that read the board on `ready`.

## 0.10.0 — 2026-09-16

### Changed

- **A comment reads like a description.** It is markdown too, drawn by the same
  renderer: a list is a list, `code` is code, and a long note has paragraphs.
  Nothing changes about what is stored, so every comment already written reads
  better the moment the panel opens. The composer says so under the box.

### Fixed

- **No env file reaches the image.** Next copies `.env` and `.env.production`
  into the standalone output, and only `.env` was ignored. A `.env.production`
  sitting beside the Dockerfile shipped in the public image. Every `.env*` is
  now out of the build context and out of the repository, except the example.
- **A missing `DATABASE_URL` says so at the start.** In production the server
  fell back to the development URL and died later on a refused connection,
  which named the port and never the cause. It now stops with
  `DATABASE_URL is not set.` The build still passes with no database at all.

## 0.9.0 — 2026-09-04

### Added

- **Find a task from the top bar.** A box beside the project name answers as you
  type: by the key a person reads on a card — `DP-4`, or just `4` — by words in
  the title, and by words in the description. Press `/` from anywhere on the
  board to reach it, the arrows to move down the hits, Enter to open one. A hit
  found only in a description carries the line it was found on, so a row always
  says why it is a hit.
- **A search reaches past the filter.** It looks at every task in the project,
  because it hides nothing and ends by opening one task. A hit the view is not
  drawing says **not in this view** on its own row, so a key somebody sent you
  still opens on a filtered board instead of quietly finding nothing.
- **The views can be put in order.** Drag a pill along the strip at the top of
  the board, or a row by its grip on the settings page: it is one order, so
  moving a view in either place moves it in both. The settings page answers the
  keyboard as well — Space lifts a row, the arrows move it, Space puts it down.
- **Any view can be made the main one.** The settings page gives the word to
  another view in one click. The main view is the one a board opens on when
  nobody has picked one, and the one view that cannot be deleted, so the word
  is given rather than taken away: naming a new main view takes it off the old
  one. Only the owner can, as with deleting a view.

## 0.8.0 — 2026-09-02

### Added

- **A view can be a list.** A view was always a board grouped by one property.
  It now has a kind: a **board**, which is what every view was, or a **list**,
  which draws one row for each task in the one order every view shares. Choose
  it when you make a view — the `+` in the view strip asks "Shows as" before it
  asks what the columns are — or change it later in **Settings → Views**. A list
  pill carries three lines where a board pill carries a dot.
- **The list is where the card order lives.** Every view in a project shares one
  order, and until now no screen showed it: a board only ever draws part of it,
  so nobody could see the order they were all sharing. Drag a row, or lift it
  with Space and move it with the arrows, and the boards move with it.
- **The columns of a list are what a card carries.** They come from
  **Settings → Card view** — the same rows, in the same order, drawn by the same
  chips. Take a property off the card and it leaves the list in the same breath.
  The key and the title open every row and stay put while a wide list scrolls
  sideways; a row that has no value for a column draws nothing, exactly as a
  card does.
- **A list can be made on a project with nothing to group by.** A board is its
  columns and cannot be, which used to make the `+` a dead end on such a project.
- **Press a heading to order a list by it.** Once for smallest first, again for
  largest first, a third time for the order the board itself keeps. A select
  orders by its own option order — Urgent above Low, not alphabetically between
  High and Medium — a multi-select by its highest option, a checklist by how far
  along it is, and a number by its size rather than its digits. A task holding
  nothing for that column goes last whichever way the order runs, and two that
  compare the same keep the rank they had.
- The order is the view's, so everybody looking at that view sees it, and it
  survives a reload. It **writes nothing**: the rank each task carries is
  untouched, so every board goes on showing what it showed before.
- **A sorted list cannot be dragged, and says so.** A chip above the list names
  the column, and its `✕` gives back the order — and the drag — in one click.

### Changed

- Changing a view between a board and a list asks nothing and loses nothing. A
  board keeps the property it grouped by, unread, so turning it back restores
  the same columns.
- A property can be deleted while a _list_ remembers it. Only a board is counted
  now, because only a board reads one.
- A colour-only chip carries its name in a list. On a card the title above it
  says what it belongs to and room is scarce; a column's heading names the
  property, never the value, so a row of bare squares says only that the task
  has one.
- Adding a task to a filtered list fills in what the filter asks for, including
  the property a board would have left to its columns.

### Note for anyone upgrading

This release adds a column to `views`, so run `npm run db:migrate` before you
start the new image — the published image runs its migrations itself. Every
view you already have reads as a **board**, so nothing on your screen changes
until you make a list or turn one of them into a list.

## 0.7.0 — 2026-08-27

### Added

- **A card view page in settings.** `…/settings/card` says what a card on the
  board carries. Every row is one thing a card could hold — your properties,
  plus the five parts a task has of its own: its ID, its title, its
  description, its checklist and its comment count. Open a row and say where it
  sits — the edge stripe, either end of the header, the body, either end of the
  footer, or nowhere — and how it reads: a colour, a name, both, a face, a
  boxed word, one line or two. It saves as you click, and the card beside the
  rows is the board's own card drawing your own tasks, so the preview cannot
  drift from the board.
- **An edge stripe.** A band of colour down the left of a card, one property at
  a time, and only a property that has colours of its own.
- **The description can sit on a card**, one line or two. It never could before.
- `PATCH /api/projects/{projectId}/card-view` writes the whole card view, or
  `null` to go back to the default. People only: an agent that lost its token
  would otherwise rearrange every card on the board.
- **The task panel is as wide as you drag it.** Its left edge is the handle —
  the arrow keys move it too — and the width it is left at is the width every
  task opens at, on this browser. A strip of the board always stays, whatever
  the window.

### Changed

- **A task's link carries the key on its card.** `?task=DP-4`, in place of a
  uuid nobody can read or say out loud. A link written before this still opens
  its task.
- **The task panel wears the colour of the card it opens**: the edge stripe, or
  the first colour the card leads with, asked of the card view rather than
  chosen by the panel. Move the edge and the panel moves with it. The priority
  is no longer said again in a pill at the top of the panel — it is a property
  row there, like every other field.
- **"On card" on the Properties page now writes the card view.** It is the
  short answer to the same question: off the card, or back where its type
  belongs. `showOnCard` on `PATCH /api/properties/{propertyId}` still works and
  means exactly that. Nothing writes `config.showOnCard` any more; an older
  project's value seeds the card it starts with.
- **A card no longer decides anything for itself.** It used to pick a lead
  select, draw multi-select values as dots and drop the grouping property.
  Those are now rows in the card view, and a new project starts with exactly
  the card the board drew before. One change is visible: the grouping property
  of a view no longer appears on the card when you switch to another view. It
  is off the card until somebody puts it on.

### Fixed

- **A click made in the first moment after a board loaded could be undone.**
  The event stream asks for the board the instant it connects, and that answer
  was still in flight when the click wrote. It landed afterwards and put the
  board back as it was, with nothing on screen to say so. A read that started
  before a write of this tab's own is now thrown away.

## 0.6.1 — 2026-08-27

### Fixed

- **Every count on a card read zero until the card was opened.** The board
  counts comments and checklist items in a subquery, and the task it counted
  for was written without naming its table. Inside the subquery that bare name
  belongs to the other table, so the count asked whether a comment is its own
  task and answered zero, every time. Opening a task then handed the real
  numbers to the card behind the panel, which is why the number looked like it
  only arrived on open. The project list counted its tasks and its people the
  same way and showed zero for both. The end to end test that covered this
  passed all along: it read the card the panel had already corrected. It now
  reads the board the server draws.

### Changed

- **The comment count on a card is drawn, not typed.** The emoji is gone. The
  count carries a hairline speech bubble, eleven pixels of inline SVG in the
  same muted mono as the checklist ratio beside it.
- **The development server listens on 3050.** 3000 is a busy port on a working
  machine. `npm run dev`, the compose file, the dev image and the Playwright
  default moved together, so development holds one number. Nothing changed for
  a running instance: the shipped image, `npm run start` and the production
  compose still listen on 3000, and so does CI.
- **The README points at the documentation site** from the top, next to what
  Ushabti is, instead of only from a badge and the last section.

## 0.6.0 — 2026-08-26

### Fixed

- **A column full of tasks scrolls instead of squashing its cards.** Past about
  a dozen cards every card in that column was pressed flat until the titles
  were unreadable. The column body always could scroll; a card clips its own
  content, which let the layout shrink it to nothing first and never reach the
  scroll.

### Added

- **A documentation site**, at
  [jaklimoff.github.io/ushabti](https://jaklimoff.github.io/ushabti/). The
  guides, the whole JSON API and the agent protocol, in one place and
  searchable. It covers what the README has never had room for: every property
  type and what it holds, the whole keyboard model, what a filter does to the
  columns, every route with its fields and its real error messages, and the run
  protocol an agent has to speak — claim, report, beat, close.

  It lives in `website/` and is built by GitHub Actions on every push to `main`.
  This file, the roadmap, the contributing guide and the security policy are
  read from the repository at build time, so a release note is written once and
  never drifts.

## 0.5.0 — 2026-08-25

### Added

- **Filters inside a view.** A view can now show only some of its tasks. The
  **Filter** button in the view strip asks which property, and the rule it makes
  appears as a chip on a line of its own under the strip — a line that exists
  only while the view is filtered, so an unfiltered board looks exactly as it
  did. Click the chip to change the rule, press its ✕ to remove it, or **Clear**
  to remove them all. Every property type can be asked about, because no field
  on a task is hardcoded: an option, a member, a word in some text, a number
  over or under, a date before or after, and "empty" for anything that can hold
  nothing. Every rule has to pass; a filter narrows, it never widens.

  The rules belong to the view and save the moment you make them, the same way
  the grouping property already does. The strip counts what you are looking at —
  `12 of 40 tasks` — so a board can never quietly be a part of itself.

  Adding one is two answers in a panel that does not move: which property, then
  what about it. Picking the property writes nothing — the board cannot know
  which priority you meant, so it does not guess one and hide half the cards
  while you decide. The panel stays open after the first value, because a rule
  usually names more than one; `‹` goes back, and Escape puts the panel away and
  keeps what you typed, because nothing in this product has a Cancel.

  Five things a filter is usually allowed to get wrong, and does not here:

  - **"is not" keeps the empties.** "Priority is not High" shows a task with no
    priority, because a task with no priority is not High. Jira drops those and
    hands people an incomplete board they believe is complete.
  - **A card added under a filter is not hidden by it.** The composer fills in
    what the filter asks for and says so before you press Enter — `Enter to add
· sets Priority Urgent`.
  - **A column you cannot drop into is not drawn.** A rule about the grouping
    property takes its columns with it, so a card can never vanish where it
    landed. A new column made under such a rule joins the rule instead of
    disappearing the moment it is named.
  - **A rule whose property or option was deleted goes with it.** Nothing tidies
    a view up when a property goes, so the rules are read afresh every time.
    A filter nobody can see never keeps hiding cards.
  - **A question with no answer is not a rule.** It lives in the panel until it
    means something, so nobody else on the board sees a half-made filter, and
    taking the answer back takes the rule with it.

### Changed

- **A column cannot be dragged while a rule hides its neighbours.** The order of
  the columns belongs to the property and everybody shares it, and a drop can
  only name the column it landed after. Through a filter that would rank the
  option after a column somebody else cannot see, and move it on their board
  too. You cannot reorder a list you are only shown part of.

## 0.4.0 — 2026-08-23

### Added

- **The board, with the keyboard alone.** One card carries the cursor and is
  the board's only tab stop, so `Tab` reaches the board in one press instead of
  one press for every card. The arrow keys move the cursor from card to card and
  across columns, holding its place in the column and stepping over a column
  with no cards; `Home` and `End` reach the ends of a column; `Enter` opens the
  card. `Space` still lifts it, and while a card is lifted the arrow keys belong
  to the drag, as before. The card you are on now says so: it wore no ring at
  all, and on a board of forty cards the keyboard drag was a promise nobody
  could find.
- **A link to a task, in one click.** The key at the top of the panel — `USH-14`
  — copies the link to that task, and the ⋯ menu says **Copy link** for anyone
  who does not think to click a label. The link opens the board with the task
  open, which the address bar already did; nothing told a person that, and
  nobody copies an address bar with a drag on a task board.

### Fixed

- **A lifted card no longer jumps over an empty column.** 0.2.1 fixed this for
  the pointer and said the keyboard was fixed with it. Only half of it was. The
  drop target is one decision and where the arrow key puts the card is another,
  and the second one still asked dnd-kit, which scores by the distance between
  corners: an empty column is as tall as the board, so its two bottom corners
  sit far below and a small card one column further over won the sum. Sideways
  the board now works the columns out for itself — the nearest one that clears
  the card, cards or no cards — and keeps the height the card was at.

## 0.3.0 — 2026-08-23

### Added

- **A run that stops answering closes itself.** A killed agent used to leave a
  card reading "active" for ever, because the server cannot see another
  machine and nothing ever wrote that run again. Now the board counts the
  agent's reports: after six minutes of silence the card says how long ago the
  agent last spoke instead of how long it has worked, and after thirty it
  closes the run as **lost** and gives the task back. Only **Take over** could
  clear a dead run before.
- **A heartbeat, so that a long build is not a dead agent.** Run
  `board.mjs beat USH-14 &` beside the work and it sends `{ "beat": true }`
  every two minutes. A beat says the process is alive and writes nothing else —
  no step, no log, and not the clock the thirty minutes counts, so a heartbeat
  left running by a killed session can never hold a card open. An agent that
  beats without reporting reads as **quiet**; one that does neither reads as
  **silent**. Killed with its session, the heartbeat closes the run on the way
  out.
- **An account page**, at `/account`, reached from the menu behind your avatar.
  Change your name, pick your colour from the palette, and change your
  password. It also counts your other live sessions and can end them all,
  which — with no password reset in the product — is the only lever a person
  has after a password they no longer trust. Nothing about a person could be
  changed before: a name typed once at registration was permanent.
- **Settings is four pages behind a rail** — Properties, Views, People,
  Project — each with its own address. `docs/agents.md` and the shipped skill
  both told people to open "Settings → Agents", which was not a place: it was
  a section two and a half screens down a single scroll.
- **Settings → People → Connect** replaces "Issue token". It hands over the
  token with a copy button and the three commands that put it to work, each
  already carrying this board's own address, and then says **Waiting for the
  first call…** until the token is used. The skill is served from the board
  itself at `/skill/SKILL.md` and `/skill/board.mjs`, so the instruction is
  true for anybody running the image rather than the repository.
- **Settings → Views can create a view.** The section named Views could rename,
  regroup and delete one, but not make one.
- **A new board says where its columns come from**, and stops saying it as soon
  as there is a task.
- **Loading states** for the board, the project list, settings and the account
  page. There were none; a slow query looked like a click that had not landed.
- **`USHABTI_SIGNUP=closed`** stops an instance taking new accounts.
- **`components/ui/`** — Button, Input, Field, Card, Row, Tag, Toasts,
  EmptyState, ConfirmRow, CopyField, Skeleton, StatusPage — behind a token
  scale for control height, radius, type and space. The same button used to be
  declared three times at three geometries, and the same input at 28, 30 and
  34 px.
- **Agents.** A project can now have machine members. An agent is a member like
  any other: it holds a person property, writes comments and appears in the
  activity log. Two things are its own — it signs in with a token instead of a
  password, and while it works it opens a _run_ on a task.
  - **Settings → Agents.** The owner creates an agent, issues a token and
    revokes it. The plain text of a token is shown once and stored as a digest.
  - **The whole JSON API accepts a token.** `Authorization: Bearer ush_…` works
    on every route the browser uses, so an agent reads and writes exactly what
    a person can, in the project the token belongs to and no other.
  - **A run makes the work visible.** While a run is open the card carries a
    strip along its bottom: the agent's name, the line it last reported, the
    time it has been going, and a bar that scans while it lives. The task panel
    grows an **Agent** tab beside Comments and Activity — its dot pulses while
    the run is live — holding the plan with its steps, the run log and the
    buttons.
  - **Pause, Stop and Take over.** Pause and Stop are requests: the agent reads
    them in the answer to its next report and obeys. Take over is not a
    request — it ends the run at once and gives the card back. Dragging a card
    an agent holds takes it over as well.
  - `docs/agents.md` has every call, and `examples/agent.mjs` is a working
    agent in about a hundred lines.
  - **A skill**, in `examples/skill/ushabti/`. Copy it into `.claude/skills/`
    and Claude Code can work on the board: `list`, `claim`, `step`, `set`,
    `comment`, `finish`. It takes property and option **names**, not ids, and
    refuses an unknown one with the real choices, so an agent cannot bake a
    board's ids into itself.
- A cleanup workflow. It drops the caches of a pull request when the pull
  request closes, drops caches that nothing has read for a fortnight, and drops
  container versions that no tag can reach. Nothing that carries a tag is
  touched.

### Changed

- The image is 308 MB, down from 775 MB, and the two architectures build side
  by side on runners of their own architecture instead of one runner emulating
  the other. The tag build took 9m42s, of which 8m58s was the emulator.
- The end to end tests now run against the production build, not `next dev`.
  CI already made that build and then threw it away, so the tests never touched
  what the image ships, and every route paid for its first compile inside a
  test. The step is 24s where it was 86s, and `e2e/global-setup.ts`, whose only
  job was warming those compiles, is gone.
- Playwright's browser is cached between runs, keyed on the Playwright version.
- CodeQL runs on `main` and weekly, not on every pull request. It takes about
  seventy seconds and has never held a change back.
- The image build writes `mode=min` build cache, scoped per architecture, where
  it wrote `mode=max` for both. `max` stored every layer of every build stage
  and filled the whole 10 GB repository cache in a day, which evicted the npm
  cache and then evicted itself.

### Fixed

- **The settings page showed no errors at all.** It called `notify()` on eight
  failure paths and never rendered the toasts, so adding a member by an email
  nobody had registered — which is how it always goes the first time, because
  there are no invites — did nothing visible whatsoever. The error now appears,
  and for that case the sign-up link to send them appears with it.
- **An agent token could take a board apart.** `DELETE` on a property, an
  option or a view asked only for membership, so any token could delete a field
  and every value in it. Those three, and the routes that add and remove
  members, are now the owner's and a person's alone.
- **An agent could clear a pause a person had asked for.** `POST
/api/runs/{id}/control` took a token, so an agent could write `resume` on its
  own run and the log would read as though a person had. Only a person may
  write a control word now.
- **Six controls destroyed data on one click.** Deleting a property, an option,
  a view, a member, an agent or a token now asks in its own row and says what
  goes with it: "Delete Labels? 5 options and 14 values go with it." Deleting a
  project asks you to type its key.
- **Changing the project key silently renamed every task.** Task keys are built
  from the prefix, so it broke every pasted link and every key an agent had
  been given. It now says how many tasks it is about to rename.
- **A live board lost changes made while it was still hydrating.** Server-sent
  events have no replay, so anything broadcast between the server render and
  the stream opening was gone for good. The board now re-syncs whenever the
  stream connects, which also covers a reconnect after a network blip or a
  laptop waking up.
- **The first-run copy on the projects page had never been seen by anybody.**
  It rendered only when the new-project form was closed, and the form opens
  itself when you have no projects.
- **A mistyped password at registration was unrecoverable.** The field has a
  reveal, and says plainly that there is no reset.
- Reordering a property refetched the whole board on every press, six times to
  move a row six places.
- The new-view panel opened at the far left of the strip however far right the
  `+` had moved, and views scrolled out of sight with no edge fade.
- The delete control for a view appeared on the pill you had just clicked to
  select it, with no confirmation. It lives in Settings → Views now.
- The user menu had no route to your account, and Sign out sat directly beside
  a link that only navigates.
- `not-found.tsx` told everybody who mistyped a URL to go and ask a colleague
  for access. `error.tsx` offered one button and no way out, and threw away the
  digest that finds the error in the log. Both, plus a new `global-error.tsx`,
  now share one look with the rest of the app.
- Settings wrapped rather than laid out below 620 px, dropping the arrows to a
  second line and stranding the card toggle on the first.
- Option colours opened the operating system's colour wheel, ignoring the
  palette the rest of the product picks from.
- Every browser tab said "Ushabti", and there was no favicon.
- The show-on-card control was an unlabelled `◉`, and the only route to project
  settings was a 26 px `⚙`.

### Note for anyone upgrading

This release adds a column to `agent_runs`, so run `npm run db:migrate` before
you start the new image. Any run already open whose agent last reported more
than thirty minutes ago closes as **lost** the first time somebody loads that
board, which is the point of the change.

## 0.2.1 — 2026-08-22

### Fixed

- A card can now be dropped into an empty column. The drop target was chosen by
  the distance between corners, and a column drop zone is as tall as the board,
  so two of its corners sit far below the card and any small card in the column
  next door won the sum. A column with cards of its own still took the drop
  through one of them; an empty one had nothing to win with. The target under
  the pointer now wins, and rectangle overlap comes next for the keyboard, which
  has no pointer and had the same fault. Dropping on the free space below the
  cards sends the card to the end of that column.
- A note being written in a task no longer disappears. The panel rebuilt its
  loader whenever the board re-rendered, and the effect that reads the task
  cleared the panel each time the loader changed. That unmounted the comment
  list and took the half-written note with it. Anything that re-renders the
  board did it: a change made by another person, or the live connection
  reporting that it is up. The panel now clears only when it moves to a
  different task, and it also stops re-reading the task on every render.
- The board no longer disappears when a card carries a `Due` date. The server
  wrote the date with the locale of the Node process and the browser wrote it
  with its own, so a browser set to British English read "28 Aug" where the
  server had sent "Aug 28". React saw the two texts disagree and threw the
  server's board away. The month names are now written out in the code, so
  both sides produce the same text.

## 0.2.0 — 2026-08-22

### Added

- `DATABASE_POOL_MAX`. One process held up to twelve connections and there was
  no way to say otherwise. That is fine for a database of Ushabti's own, and
  wrong on a managed cluster shared with other applications, where the whole
  server may allow only 25. The default has not changed.

### Note for anyone on a managed database

`node-postgres` verifies the certificate when the connection string says
`sslmode=require`, which is stricter than libpq and stricter than most other
drivers. On DigitalOcean and similar, pass the provider's CA and ask for
`sslmode=verify-full&sslrootcert=/path/to/ca.crt`.

## 0.1.0 — 2026-08-22

The first release.

### Added

- Email and password sign-in. Projects with members, added by email.
- Custom properties: select, multi-select, person, text, number, date and
  checkbox. No field on a task is hardcoded, not even Status.
- Views. Each one is a board grouped by a select, person or checkbox property.
- Drag and drop for cards and for columns, with the pointer or the keyboard.
- Task detail: markdown description, checklist, comments and an activity log.
- Live updates over server-sent events.
- Docker Compose for development, a production image on Docker Hub and on the
  GitHub registry, and migrations that run when the container starts.
- 14 unit tests and 18 end-to-end tests, run on every pull request together with
  ESLint, Prettier, the types, the production build and a CodeQL scan.

### Built on

Next.js 16 with Turbopack, React 19, PostgreSQL 18 with Drizzle, Node 24.

### Known limits

- Eight warnings from `react-hooks/set-state-in-effect`. The pattern works but
  is worth removing.
- One card order for all views, no rate limit on sign-in, no password reset.
  The end of [ROADMAP.md](ROADMAP.md) has the full list.
