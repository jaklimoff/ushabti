# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the numbers follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

While the major number is 0, a minor bump may break something. From 1.0.0 the
usual promise applies: a patch fixes, a minor adds, a major breaks.

## Unreleased

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
