# Roadmap

Where Ushabti is, and where it goes next. Short by design.

---

## Done — v1 (2026-08-21)

Everything below works, is tested, and runs in the dev container.

**Accounts and projects**

- Email and password sign-in, session cookie in the database.
- Projects with members. The owner adds a person by email.

**Custom properties** — the whole point of the product

- Seven types: select, multi-select, person, text, number, date, checkbox.
- Create, rename, recolour, reorder, delete. Nothing is hardcoded, not even Status.
- A new project starts with Status, Priority, Assignee, Phase, Estimate, Labels and Due. All of them are ordinary rows you can change or remove.
- Show or hide each property on the card.

**Views**

- A view is a board grouped by one select, person or checkbox property.
- Add and delete views. A new project starts with Board (by Status) and Phases (by Phase).

**Board**

- Drag a card inside a column and between columns.
- Drag a column header to reorder the options of the grouping property.
- Keyboard drag: Space picks up, arrows move, Space drops, Escape cancels.
- Add a column, which adds an option to the grouping property.
- Add a task from the column header or from the empty area below the cards.

**Task detail**

- Title, markdown description, checklist with a progress bar, markdown comments, activity log.
- Every field edits in place. No dialogs.
- A task has its own link (`?task=…`).
- The panel is dragged as wide as the reading needs, by its own left edge.

**Shared use**

- Live updates over server-sent events. A change reaches every open board in about a second.

**Agents** — humans and machines on the same board

- An agent is a machine member of a project. It can be the value of any person property, write comments and appear in the activity log.
- The owner creates agents and issues tokens in Settings. A token opens one project, is shown once and is stored as a digest.
- Every JSON route accepts `Authorization: Bearer ush_…`, so an agent uses the same API as the browser.
- A run shows the work: a strip along the bottom of the card names the agent, its current step and its age; an Agent tab in the task panel, whose dot pulses while the run is live, adds the plan and the run log.
- Pause and Stop are requests the agent reads and obeys. Take over ends a run at once, and so does dragging a held card.
- A skill in `examples/skill/ushabti/`, so Claude Code can work on the board without being told how each time.

**Engineering**

- Docker Compose and a VS Code dev container.
- A production image and `docker-compose.prod.yml` for self-hosting. Migrations run at start.
- Generated Drizzle migrations in `drizzle/`.
- Seed script with a demo project, two accounts and an agent with a live run.
- 24 unit tests, 24 end-to-end tests. All pass from a cold server.
- GitHub Actions runs the types, both test suites and the production build.

---

## Done — v1.1 (2026-08-22)

Everything off the board, brought up to the board's standard.

- **Settings is four pages behind a rail** — Properties, Views, People, Project —
  each with its own address, so a doc can link to one. It was a 2,400 px scroll
  with the two things people came for at the bottom.
- **Errors on the settings page are visible.** It called `notify()` on eight
  paths and rendered no toasts at all, so "no account uses that email" arrived
  on a screen that showed nothing.
- **Nothing destructive happens on one click.** Deleting a property, an option,
  a view, a member, an agent or a token asks in its own row first, and says what
  goes with it in real numbers. Deleting a project asks for the key.
- **Structure is the owner's, and only a person's.** An agent token could delete
  a property, delete a view, and clear a pause a person had asked for. It cannot
  now.
- **An account page.** Name, colour from the palette, password, and a count of
  your other sessions with a way to end them. None of it could be changed before.
- **Connecting an agent is a recipe, not a file path.** The token gets a copy
  button, the commands carry the board's own address, the skill is served from
  `/skill/…`, and the panel says when the agent answered.
- **The project key warns before it renames every task.**
- **Loading, error and not-found states.** No route had a loading state; the
  error page trapped you with one button and no digest.
- **A shared `components/ui/`** with a token scale behind it, so a button is one
  size everywhere off the board rather than three.
- **A live board re-syncs when its stream connects**, so a change made while the
  page was hydrating is no longer lost for good.

---

## Next — the things that make daily use better

Nothing. The list is empty, which is where it should be before anybody else
runs this.

## Later

- **A per-view card order.** See the limit below.
- **Relative dates in a filter.** A date rule names a day today, so "due this
  week" has to be rewritten every week. A relative window has to read the same
  on the server and in the browser, which a clock in two time zones does not.
- **Email invites that send email.** An invite exists: the owner adds an email that has no account, and the person joins as they sign up. Nothing sends them the link yet.
- **Import.** Read a Trello or Jira export and map lists to options.
- **Attachments.** Files on a task.

---

## Done since v1.1, not yet released

- **A task can say what it waits on.** It lived in comments, where nothing
  could read it: an agent picking a task up could not tell that the work in
  front of it was not ready, and a person reading the board could not see why
  a card was not moving. Now a task names the tasks that block it. The card
  wears one small grey chain beside its key and nothing else — no list, no
  count, because a board where half the cards are waiting still has to be
  readable. The panel holds the two short lists, **Blocked by** and **Blocks**,
  each adding by the same box the filter uses and removing with a ✕ that asks
  nothing. **Blocked** joins the filter as a fixed word rather than a property,
  the way a card's key is a fixed row. A circle is refused with one sentence,
  under the project lock. `POST /api/tasks/{id}/blockers` and its `DELETE` both
  take a token, and `board.mjs link USH-71 --blocked-by USH-12` is the short
  way. A blocker stops blocking when it is over, and the owner says what over
  means in **Settings → Project**: archived, and one option of one property if
  they name one. Nothing is hardcoded, so there is still no Done status.
  **The chain strip is not in.** The roadmap promised "the chain strip from the
  design" and `design-reference/Roadmap Board.dc.html` holds none — its one
  card strip is the run. If another design file exists, the strip comes back as
  its own change.

- **A board reads on a phone.** It was the last screen that did not fit: the
  panel already overlaid below 900 px and the settings pages already fitted at
  390 px, but the board drew every column side by side and scrolled sideways.
  Below 560 px — two 272 px columns need 576 — it draws one column the width of
  the screen, with a strip of column pills above it: a dot, the name and the
  count, the one on screen filled. It is not a second view strip; it names
  columns, and nothing in it drags. A pill, a 60 px swipe and the arrow keys
  all reach another column through one piece of state, and the arrows use the
  cursor the board already has rather than a second walker. A phone opens on
  the first column every time. Dragging a card, dragging a column and folding
  are out: a card moves by the grouping property in its panel, or by **Set…**
  on several at once, which is the one value a drop across a board writes.
  Where there is no hover, the check that picks a card is simply drawn.

- **A deleted task can come back for thirty days.** Delete was the one press
  with nothing behind it: the row went, and its comments, its checklist and its
  history went with it. Now a delete is a mark on the task. It leaves every
  board, list, search and count at once, and every route about it answers
  `404` — which is what delete has to mean — but the row is still there. The
  archive page gained a second list, **Deleted, gone in 30 days**, newest
  first, with the days left and one **Put back** that returns the task whole,
  with the key it had. `DELETE /api/tasks/{id}` now answers `goesAt`, the
  `deleted` feed line carries `action`, `key` and `goesAt`, and there are two
  new routes: `POST /api/tasks/{id}/restore` and
  `GET /api/projects/{id}/deleted`. The sweep runs on a delete and on a read
  of that list, because there is no timer in Ushabti. Thirty days is one
  number in the docs, not a project setting.

- **Pick several cards and set one property on all of them.** Moving ten cards
  to a new owner one at a time was the tenth-time friction a team notices most.
  Hover a card and a check appears in its corner; `x` picks the one the cursor
  is on, and Shift-click picks a run inside one column. A picked card wears a
  border and nothing more. A bar in the top bar says **3 selected** and offers
  **Set…**, which asks the two questions the filter asks — which property, then
  what about it — and writes them all in one call,
  `POST /api/projects/{id}/tasks/values`, which an agent may make too. Escape,
  the ✕ or a change of view ends it, and a card a filter hides leaves the count
  quietly. Archive from the bar, and picking on a list, come next.

- **A page lists the archived tasks.** A search and the task's own link were
  the two ways back to one: enough to find a task you can name, and nothing at
  all for one you cannot. **Archive** in the top bar, beside **Settings**,
  opens `/p/{project}/archived`: every archived task, newest first, with the
  key, the title, when it went and one **Put back**. The key and the title open
  the task as its link does, and a box narrows the list by key and title. It is
  not a view, so it is not in the view strip, and it asks the server nothing:
  the browser already carries the archived rows.

- **A webhook rings when something changes.** An agent listens on the stream;
  a serverless function, a CI job or a chat bot has nowhere to listen from.
  The owner gives a URL in **Settings → Webhooks** and the board posts to it:
  the kind, the task and the moment, never the change, signed with HMAC-SHA256
  over the timestamp and the body. Four tries, at 1m, 5m and 30m. Nothing is
  on the path of a write, so a receiver that is down costs one INSERT and
  slows nobody's board. See [docs/webhooks.md](docs/webhooks.md).

---

## Known limits

These are consequences of the design, not defects. Read them before you build on top.

- **One card order for all views.** A task has a single `position`. Moving a card in the Board view also moves it in the Phases view, and moving a row in a list moves it on every board. This keeps a drag to one row write. A per-view order needs a second table. A list is the one screen that shows this order whole; on a board you only ever see part of it.
- **A sorted view cannot be dragged inside itself.** A drag writes a rank, and
  a sorted list or a sorted column is not showing ranks, so the rows and the
  cards hold still until the order is given back. A card can still be carried
  to another column, because that writes a value and not a rank. There is one
  order in a project and this is the price of it.
- **A list draws every row it shows.** Like the board, and for the same reason: above a few thousand tasks it needs paging. A row is cheaper than a card, so the ceiling is higher, not different.
- **A list shows what a card shows.** Its columns are the project's card view, so the property a board groups by is missing from a list until somebody puts it back on the card in Settings → Card view — the default leaves it off because a board's columns already say it. The alternative was worse: a rule that restored it would make the column vanish the day somebody edited an unrelated row.
- **A board loads all its tasks at once.** Fine for a few thousand. It needs paging above that.
- **A deleted row waits for somebody to look.** The sweep that takes a task
  past its thirty days runs on a delete in that project and on a read of the
  deleted list. There is no timer in Ushabti and this is not the reason to
  build the first one. So a project that deletes one task and then never
  deletes another keeps that row past its window until somebody opens the
  archive page — hidden from every read the whole time, and gone the moment
  anybody looks.
- **The browser never loads a deleted task**, unlike an archived one. It is
  not on the board answer at all, because a deleted task must reach no board,
  no list, no search and no count. The archive page asks for that list itself,
  which is why it is the one page that already pages the way the rest will
  have to.
- **The browser loads the archived tasks too**, in `archived` beside `tasks`,
  because the search reads every task in the project and a link to an archived
  one still opens its panel. They are carried light — the key, the title, the
  description, the rank and the date — with no values and no counts, so a long
  archive costs a row of words each and nothing more. No view draws them; the
  archive page draws the same rows. It follows the line below: the day a board pages, the archive has to become a
  query first.
- **Search reads the board the browser already has**, which is why it answers on
  the keystroke and asks the server nothing. It follows the line above: the day
  a board pages, search has to become a query. It looks at the key, the title
  and the description, and at nothing else — a comment or a checklist item is
  not searched.
- **The activity log has no limit.** The panel reads the last 60 entries, but the table only grows.
- **The webhook sender is one process deep**, like the rate limit. One drain
  runs at a time inside a process; a second process would drain the same queue
  and could send one delivery twice. Every body carries a `delivery` id for
  exactly that, and a receiver is told to skip an id it has seen.
- **A webhook keeps its last 20 deliveries.** Older ones go as new ones
  arrive, on the write and with no timer — the same sweep a new reset link
  does on the spent ones. The record is for reading, not for auditing; the
  feed is the record.
- **A delivery that fails four times is dropped.** By then it is old news, and
  the way to catch up is `/activity?after=…`, which is what the feed is for.
- **Only select, person and checkbox properties can group a board.** A multi-select would put one task in several columns, which the drag logic does not handle. A list groups by nothing, so this does not reach it.
- **A property cannot be deleted while a view groups by it.** Point the view at another property first. This is on purpose: a view without its property is meaningless.
- **One open run per task.** A second agent that claims the same task gets a 409. Two agents on one card would need a lock nobody can hold.
- **A waiting run holds its card until somebody answers or takes it over.** The
  board never closes it for silence, because waiting is silence on purpose.
- **The watcher needs a POSIX shell.** `--run` goes through `sh`, and stopping a
  session stops its process group. On Windows, run it under WSL.
- **The rate limit is one process deep.** Ten failed sign-ins, sign-ups or agent
  tokens in ten minutes are answered 429 — per address, and per email on
  sign-in. The count is in memory, so a restart forgets it and a second process
  would keep a count of its own. A proxy that limits requests is still worth
  having in front, and it is the proxy that writes the `x-forwarded-for` the
  limit reads. `USHABTI_SIGNUP=closed` stops new accounts altogether.
- **Pause and Stop are cooperative.** Ushabti cannot reach into another machine. An agent that ignores the control word keeps running; the log records the request, and Take over always works.
