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

**Shared use**

- Live updates over server-sent events. A change reaches every open board in about a second.

**Engineering**

- Docker Compose and a VS Code dev container.
- A production image and `docker-compose.prod.yml` for self-hosting. Migrations run at start.
- Generated Drizzle migrations in `drizzle/`.
- Seed script with a demo project and two accounts.
- 14 unit tests, 18 end-to-end tests. All pass from a cold server.
- GitHub Actions runs the types, both test suites and the production build.

---

## Next — the things that make daily use better

1. **Filters and sorting inside a view.** Show only my tasks, only this label, only what is due this week. `views.config` is already a JSON column kept free for this.
2. **Search.** Find a task by key or by words in the title. A box in the top bar, results as you type.
3. **Keyboard shortcuts.** `n` for a new task, `/` for search, arrow keys to move between cards, `Esc` to close.
4. **Archive instead of delete.** A deleted task is gone for good today. Archive keeps it out of the board but keeps the history.
5. **Drag to reorder properties** in the settings page. Today you use the up and down arrows.
6. **Remove the eight `setState` calls inside effects.** They reset a field when the task or the option changes. Keying the component is the React answer. ESLint reports each one as a warning.

## Later

- **A list view.** The board is the only layout. A dense table with sortable columns suits a long backlog better.
- **Blocked-by links.** Task dependencies and the chain strip from the design.
- **A per-view card order.** See the limit below.
- **Bulk edit.** Select several cards, set one property on all of them.
- **Profile page.** Change your name, your colour and your password.
- **Email invites.** Today the person must register first, and only then can the owner add their email.
- **Import.** Read a Trello or Jira export and map lists to options.
- **Attachments.** Files on a task.
- **Undo.** At least for a delete.
- **A narrow-screen board.** The panel already overlays below 900 px, but the board itself needs a real phone layout.

## Before anyone else runs this

- **Rate limiting on sign-in and sign-up.** Nothing stops a password guessing attack today. Put a proxy in front until this is done.
- **Password reset.** There is no way back into an account.
- **Agents.** The product is meant for humans and agents on the same board. Nothing agent-related is built: no API tokens, no machine members, no webhooks.

---

## Known limits

These are consequences of the design, not defects. Read them before you build on top.

- **One card order for all views.** A task has a single `position`. Moving a card in the Board view also moves it in the Phases view. This keeps a drag to one row write. A per-view order needs a second table.
- **A board loads all its tasks at once.** Fine for a few thousand. It needs paging above that.
- **The activity log has no limit.** The panel reads the last 60 entries, but the table only grows.
- **Only select, person and checkbox properties can group a board.** A multi-select would put one task in several columns, which the drag logic does not handle.
- **A property cannot be deleted while a view groups by it.** Point the view at another property first. This is on purpose: a view without its property is meaningless.
