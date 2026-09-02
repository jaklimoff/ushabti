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

- Title, markdown description, checklist with a progress bar, comments, activity log.
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

1. **Sorting inside a view.** Filters shipped; the order did not. A view still
   shows the one card order every view shares. The list is where that order can
   now be seen and dragged, which is what makes a sort worth having — and the
   answer it will need is already decided: a sorted list turns its drag off and
   says so, because a drag under a sort writes an order nobody can see.
2. **Search.** Find a task by key or by words in the title. A box in the top bar, results as you type.
3. **Keyboard shortcuts.** `n` for a new task, `/` for search, arrow keys to move between cards, `Esc` to close.
4. **Archive instead of delete.** A deleted task is gone for good today. Archive keeps it out of the board but keeps the history.
5. **Drag to reorder properties** in the settings page. Today you use the up and down arrows, but they no longer refetch the whole board on every press.
6. **Remove the remaining `setState` calls inside effects.** Eight are left, all on the board and the task panel. Keying the component is the React answer. ESLint reports each one as a warning.

## Later

- **Blocked-by links.** Task dependencies and the chain strip from the design.
- **A per-view card order.** See the limit below.
- **Relative dates in a filter.** A date rule names a day today, so "due this
  week" has to be rewritten every week. A relative window has to read the same
  on the server and in the browser, which a clock in two time zones does not.
- **A filter that says "me".** A person rule names one member, so a shared view
  filtered to "my tasks" is one named person's tasks on everybody's screen.
- **A run history.** A closed run keeps its rows, but nothing shows them. Only the activity line survives on screen.
- **Bulk edit.** Select several cards, set one property on all of them.
- **Email invites.** Today the person must register first, and only then can the owner add their email.
- **Import.** Read a Trello or Jira export and map lists to options.
- **Attachments.** Files on a task.
- **Undo.** At least for a delete.
- **A narrow-screen board.** The panel already overlays below 900 px, but the board itself needs a real phone layout.

## Before anyone else runs this

- **Rate limiting on sign-in, sign-up and agent tokens.** Nothing stops a guessing attack today. Put a proxy in front until this is done. `USHABTI_SIGNUP=closed` at least stops new accounts.
- **Password reset.** There is no way back into an account you cannot sign in to. You can change a password you still know, on `/account`.
- **Webhooks.** An agent has to poll the board or the event stream. There is no call out when something changes.

---

## Known limits

These are consequences of the design, not defects. Read them before you build on top.

- **One card order for all views.** A task has a single `position`. Moving a card in the Board view also moves it in the Phases view, and moving a row in a list moves it on every board. This keeps a drag to one row write. A per-view order needs a second table. A list is the one screen that shows this order whole; on a board you only ever see part of it.
- **A list draws every row it shows.** Like the board, and for the same reason: above a few thousand tasks it needs paging. A row is cheaper than a card, so the ceiling is higher, not different.
- **A list shows what a card shows.** Its columns are the project's card view, so the property a board groups by is missing from a list until somebody puts it back on the card in Settings → Card view — the default leaves it off because a board's columns already say it. The alternative was worse: a rule that restored it would make the column vanish the day somebody edited an unrelated row.
- **A board loads all its tasks at once.** Fine for a few thousand. It needs paging above that.
- **The activity log has no limit.** The panel reads the last 60 entries, but the table only grows.
- **Only select, person and checkbox properties can group a board.** A multi-select would put one task in several columns, which the drag logic does not handle. A list groups by nothing, so this does not reach it.
- **A property cannot be deleted while a view groups by it.** Point the view at another property first. This is on purpose: a view without its property is meaningless.
- **One open run per task.** A second agent that claims the same task gets a 409. Two agents on one card would need a lock nobody can hold.
- **Pause and Stop are cooperative.** Ushabti cannot reach into another machine. An agent that ignores the control word keeps running; the log records the request, and Take over always works.
