# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the numbers follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

While the major number is 0, a minor bump may break something. From 1.0.0 the
usual promise applies: a patch fixes, a minor adds, a major breaks.

## Unreleased

### Added

- **A run that stops answering closes itself.** A killed agent used to leave a
  card reading "active" for ever, because the server cannot see another
  machine and nothing ever wrote that run again. Now the board counts the
  agent's reports: after six minutes of silence the card says how long ago the
  agent last spoke instead of how long it has worked, and after thirty it
  closes the run as **lost** and gives the task back. Only **Take over** could
  clear a dead run before.
- **A heartbeat, so that a long build is not a dead agent.** `board.mjs beat
USH-14 &` sends `{ "beat": true }` every two minutes. A beat says the
  process is alive and writes nothing else — no step, no log, and not the
  clock the thirty minutes counts, so a heartbeat left running by a killed
  session can never hold a card open. An agent that beats without reporting
  reads as **quiet**; one that does neither reads as **silent**. Killed with
  its session, the heartbeat closes the run on the way out.
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

### Added

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
