# Where a test belongs

A test goes in the smallest place that can still see the fault. There are
four places.

| Kind          | What it checks                                                   | Where                                                         | Runs in                      |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| Unit          | Logic: a rule, a reading, a sum. No screen and no request.       | `src/lib/__tests__/*.test.ts`                                 | Node                         |
| Component     | What a component draws, and what a press or a key sends.         | `*.test.tsx` beside the component                             | Chromium, by Vitest          |
| Route         | Who may call a route, and what it answers and writes.            | `src/lib/__tests__/*-route.test.ts`, with the rows faked      | Node                         |
| End to end    | Several boards, a drag across columns, mail, webhooks, uploads, a reload, a second tab, and one walk through each main flow. | `e2e/*.spec.ts` | Playwright, against a server |

`npm test` runs the first three: a Node project and a Browser Mode project,
both in `vitest.config.ts`. It must stay under a minute.
`npm run test:e2e` runs the last.

## How to choose

Ask what the test needs that a smaller place does not have.

- **Only values in and values out.** A unit test. Most rules of this board
  already live in `src/lib`, so most logic is one import away.
- **A screen, but one browser and no server.** A component test. Browser Mode
  has real layout, real CSS modules and real pointer and key events, so a
  label on one line, a row that scrolls sideways, focus and a phone width are
  all component tests. So is a race the screen must survive: the fake answers
  when the test says so.
- **The server's answer.** A route test. Which role may call it, which status
  it answers, and what it leaves in the rows. `attachments-route.test.ts`
  shows the shape: the caller, the rows and the store are faked, and the
  handler is real.
- **Something only a whole system has.** End to end: a reload that has to
  find what was saved, a second tab or a second person, the stream, a drag
  across columns, mail, a webhook, an upload through the bucket, a server
  render and a hydration in different zones, and one walk through each main
  flow with `@smoke` on it.

A test that needs a reload only to check that a write was saved is two
smaller tests: the component test says what was sent, and the route test
says what was kept.

## Writing a component test

`src/test/board.tsx` draws a component inside a real board store.
`newProject()` builds the board a new project starts with, `withTask()` puts
a task on it with values named as a person reads them, and
`renderWithBoard()` draws the component. Nothing reaches a server: every
request is answered in the page, `{}` unless the test answers it, and
`sent()` lists what went out. The stream is stubbed, so nothing rings.

```tsx
const data = newProject();
withTask(data, "Urgent thing", { Status: "Todo", Priority: "Urgent" });
const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data);

await page.getByTestId("filter-chip").click();
await expect.poll(() => sent("PUT", /\/lens$/).length).toBe(1);
```

`next/navigation` and `next/link` are stood in for by `src/test/`, because no
app router is mounted in a test. The page is 1440 by 900, as in the end to
end suite; `page.viewport(390, 780)` makes it a phone. Locators match words
as Playwright's do, so a test moved down reads as it did.

A drag that dnd-kit or a grip has to see is `commands.drag(from, to)`, which
walks Playwright's own mouse there in small steps; `userEvent.dragAndDrop`
jumps once and dnd-kit never lifts. A reload is a second `renderWithBoard`
with `{ keepStorage: true }`, which keeps what the browser stored, and
`{ user }` signs in somebody other than `ME`.

A test moved down from `e2e/` checks what it checked there, and carries the
name it had there, or names that test in a comment.

## What the filters pilot saved

`e2e/filters.spec.ts` was the pilot (USH-268). Measured on one worker against
the dev server, and with `npx vitest run --project browser`:

|                                     | Tests | Seconds of test time |
| ----------------------------------- | ----: | -------------------: |
| `filters.spec.ts` before            |    25 |                  139 |
| Moved to `Filters.test.tsx`         |    13 |                   73 |
| `filters.spec.ts` after             |    12 |                   41 |
| `Filters.test.tsx`, which took them |    14 |                   12 |

One end to end test became two component tests: the refused **Save for
everyone** has a race half and a half where the clash is on screen.

## The plan for every spec

One line per spec file, with how many of its tests stay end to end and where
the rest go. **move** means most of it goes down, **keep** that most stays,
and **drop** a test that a unit test already holds. The kept tests of a file
may later be folded into one walk. The totals leave 86 tests end to end, and
the walks still to be written for the main flows bring it to about 100, on
four workers at most.

| Spec | Tests | Plan | Stays | Component | Unit | Route | Drop | Why |
| --- | --: | --- | --: | --: | --: | --: | --: | --- |
| `account.spec.ts` | 8 | move | 1 | 6 |  | 1 |  | Each face and password box is a component; one walk keeps the menu route and the board following the name. |
| `agent-face.spec.ts` | 2 | done (USH-269) |  | 1 |  | 1 |  | Who may change a face is the route's answer; the typed emoji is the box. |
| `agent-rename.spec.ts` | 2 | done (USH-269) | 1 |  |  | 1 |  | The watcher waking on the new name needs the stream and the harness. |
| `agent-rules.spec.ts` | 2 | done (USH-269) |  | 1 |  | 1 |  | The claim carrying the rules is a route; the closed tab is `pagehide` on the box. |
| `agents.spec.ts` | 17 | done (USH-269) | 3 | 2 | 2 | 10 |  | Tokens, beats, the lease and the refusals are route answers. Keep the first run on the board, the drag that takes over, and the silent run that closes itself. |
| `archive-retry.spec.ts` | 2 | move |  |  |  | 2 |  | Both are what a second archive writes. |
| `archive.spec.ts` | 12 | move | 2 | 8 |  | 2 |  | Keep archive and put back from the panel, and the archive page. The panel's races are component tests with a held answer. |
| `ask-mail.spec.ts` | 1 | keep | 1 |  |  |  |  | Mail runs on the server's environment. |
| `attachments.spec.ts` | 2 | keep | 1 | 1 |  |  |  | An upload through the bucket stays; the 503 sentence is Settings drawing an answer. |
| `bad-id.spec.ts` | 2 | move |  |  |  | 2 |  | `readId` already has unit tests; one route test per door says the sentence. |
| `blockers.spec.ts` | 4 | move |  | 3 |  | 1 |  | Being over takes the chain off is the board read; the rest is the panel. |
| `board.spec.ts` | 36 | done (USH-270) | 17 | 19 |  |  |  | Keep the first walk, the four pointer drags, the two keyboard drags, the copy link, the counts, an order across a reload, the finger and the drop onto a folded column. The plan kept 14, but ten tests carry `@smoke` and stay, and the fold's drop is a drag across columns, so its fold half went down alone and its drop stayed. The phone move and the title saved on a closed tab need nothing a component lacks: `pagehide` is counted there, which end to end could not. The small-tablet tests went down, and the builder rule that names them moved with them. |
| `cadence.spec.ts` | 7 | move | 1 | 4 |  | 2 |  | Keep shipping the last sprint. The layout rows are Settings drawn at two widths. |
| `card-view.spec.ts` | 10 | move | 1 | 9 |  |  |  | Keep the drag in Settings that moves the card, the panel and the list. |
| `changed.spec.ts` | 4 | move |  | 1 |  | 3 |  | What moves the changed time is the server's write. |
| `changelog.spec.ts` | 6 | move | 1 | 1 |  | 4 |  | Keep one shipped walk. Public, private and the token are route answers. |
| `close-sprint.spec.ts` | 1 | move |  |  |  | 1 |  | What a close archives is a route answer. |
| `collaboration.spec.ts` | 9 | keep | 7 | 1 | 1 |  |  | Two people on one board is what end to end is for. The member list is a component; the shared Me is `applyFilters`. |
| `comment-delete.spec.ts` | 1 | move |  |  |  | 1 |  | Who may delete is a route answer; the question folds into the comment component tests. |
| `comment-edit.spec.ts` | 7 | move | 1 | 5 |  | 1 |  | Keep the save that crossed a newer one. The box's keys and its closed tab are the component. |
| `composer.spec.ts` | 2 | move |  | 2 |  |  |  | How the composer grows is layout, which Browser Mode has. |
| `done-when.spec.ts` | 6 | move |  | 1 |  | 5 |  | What frees a blocker and what Ship archives are server answers. |
| `drop-hidden.spec.ts` | 13 | move | 1 | 5 |  | 7 |  | Keep the writes that land at once. The questions are the panel and the bar; the drops are the routes. |
| `editing-sign.spec.ts` | 2 | move | 1 | 1 |  |  |  | Keep two editors on one task. The phone line is layout. |
| `editor-open.spec.ts` | 3 | keep | 2 | 1 |  |  |  | Which chunk loads when needs the production build. |
| `ended-sprint.spec.ts` | 5 | move |  | 2 | 1 | 2 |  | The header is a component; the read that writes nothing is a route. |
| `export.spec.ts` | 1 | move |  |  |  | 1 |  | Who may download is a route answer. |
| `filters.spec.ts` | 12 | move | 8 |  |  | 4 |  | Moved 14 to `Filters.test.tsx` in USH-268. The four that call the API go to route tests. Keep the reloads, the closed tab, the two tabs, the deleted option and the zones. |
| `forgot.spec.ts` | 1 | keep | 1 |  |  |  |  | Mail runs on the server's environment. |
| `former.spec.ts` | 3 | move |  | 1 | 1 | 1 |  | `personOf()` and the board read answer for somebody who left. |
| `github-step.spec.ts` | 3 | keep | 3 |  |  |  |  | A script against a real server; nothing smaller runs it. |
| `import.spec.ts` | 4 | move | 1 | 1 |  | 2 |  | Keep one Trello file through the page. |
| `iteration.spec.ts` | 3 | move | 1 | 2 |  |  |  | Keep the walk from grouping to the roadmap. |
| `links.spec.ts` | 2 | move |  | 2 |  |  |  | The panel and the card draw a link. |
| `list.spec.ts` | 19 | move | 2 | 16 |  | 1 |  | Keep the drag the board sees and the order across a reload. The rest is what a list draws. |
| `listening.spec.ts` | 12 | done (USH-269) | 5 | 2 |  | 5 |  | Keep the stream, the watcher and the harness. The feed and its pages are route answers. |
| `live-preview.spec.ts` | 16 | move | 1 | 15 |  |  |  | The editor is a component with real layout; keep the chunk fetched as the panel opens. |
| `long-title.spec.ts` | 1 | move |  | 1 |  |  |  | A card clamped to three lines is layout. |
| `mail.spec.ts` | 1 | keep | 1 |  |  |  |  | Mail runs on the server's environment. |
| `markdown-wrap.spec.ts` | 2 | move |  | 2 |  |  |  | Wrapping is layout. |
| `mention.spec.ts` | 4 | move |  | 4 |  |  |  | The @ list is a component. |
| `option-dates.spec.ts` | 12 | move |  | 8 |  | 4 |  | The boxes and their closed tab are Settings; who may write is the route. |
| `option-names.spec.ts` | 6 | move | 1 | 2 |  | 3 |  | Keep two creates at once, which needs the real database. |
| `panel-a11y.spec.ts` | 6 | move |  | 6 |  |  |  | Focus and roles are what a component test reads best. |
| `parents.spec.ts` | 3 | move |  | 2 |  | 1 |  | One level deep is the server's rule. |
| `password-fill.spec.ts` | 3 | move |  | 3 |  |  |  | A value with no event is a box. |
| `pick-labels.spec.ts` | 3 | move |  | 2 |  | 1 |  | The bulk route keeps what it did not change. |
| `pick.spec.ts` | 18 | move | 1 | 13 |  | 4 |  | Keep one Set on several cards. The 500s and the refusals are route answers. |
| `presence.spec.ts` | 4 | keep | 2 | 1 |  | 1 |  | Two people and a dying tab need the stream. |
| `progress.spec.ts` | 4 | move |  | 2 | 1 | 1 |  | `progressOf` sums the bar; the header is a component. |
| `project-waiting.spec.ts` | 2 | done (USH-269) | 1 |  |  | 1 |  | Keep the count that changes live. |
| `properties.spec.ts` | 13 | move | 1 | 10 |  | 2 |  | Keep making a property and grouping a board by it. |
| `rank.spec.ts` | 1 | move |  |  |  | 1 |  | The mend is the create route; `rank.ts` already has unit tests. |
| `rate-limit.spec.ts` | 1 | move |  |  |  | 1 |  | The limit is the route's answer. |
| `reset.spec.ts` | 3 | keep | 1 |  |  | 2 |  | Keep the link that works once and signs in. |
| `reveal.spec.ts` | 2 | move |  | 2 |  |  |  | The eye is a box. |
| `roadmap.spec.ts` | 6 | move |  | 4 | 2 |  |  | `roadmapRows()` says where a bar starts; the rest is the canvas. |
| `roles.spec.ts` | 3 | move |  | 1 |  | 2 |  | The role rule is the route's; the question before Make owner is a row. |
| `run-history.spec.ts` | 2 | done (USH-269) |  | 1 |  | 1 |  | Paging is the route; the panel draws the pages. |
| `search.spec.ts` | 6 | move |  | 6 |  |  |  | The box and its list; `searchTasks()` already has unit tests. |
| `select-menu.spec.ts` | 3 | move |  | 3 |  |  |  | The menu is a component. |
| `settings-controls.spec.ts` | 6 | move |  | 6 |  |  |  | Sizes and colours are what a component test measures. |
| `settings-load.spec.ts` | 4 | move | 1 | 1 |  | 2 |  | Keep a change by somebody else reaching Settings. |
| `settings-select.spec.ts` | 4 | move |  | 4 |  |  |  | The menu is a component. |
| `settings.spec.ts` | 21 | move | 2 | 17 |  | 2 |  | Keep the invite that joins on sign-up and the main view the board opens on. |
| `ship.spec.ts` | 6 | move | 1 | 3 |  | 2 |  | Keep Move, which archives and moves on. |
| `shipped-iteration.spec.ts` | 5 | move |  | 3 |  | 2 |  | What leaves the board is the read; the fold is Settings. |
| `sprints.spec.ts` | 4 | move | 2 |  |  | 2 |  | Keep the two migrations, which need the real database. |
| `stamps.spec.ts` | 3 | move | 1 | 1 | 1 |  |  | Keep server and browser reading the same day. |
| `switcher.spec.ts` | 6 | move |  | 6 |  |  |  | The switcher is a menu. |
| `task-keys.spec.ts` | 1 | move |  | 1 |  |  |  | A key in Markdown is the page's rule. |
| `text-save.spec.ts` | 5 | move |  | 4 |  | 1 |  | A conflict is a 409 the fake can answer. |
| `type-defaults.spec.ts` | 7 | move |  | 3 |  | 4 |  | What a create starts with is the route's answer. |
| `types.spec.ts` | 4 | move |  | 3 |  | 1 |  | The Types page is a component. |
| `undo-delete.spec.ts` | 8 | move | 1 | 3 |  | 4 |  | Keep the delete that comes back whole. |
| `upload.spec.ts` | 4 | keep | 2 | 2 |  |  |  | Keep the two uploads through the bucket. |
| `waiting.spec.ts` | 4 | done (USH-269) | 1 | 3 |  |  |  | Keep an answer from the list. |
| `webhooks.spec.ts` | 6 | keep | 4 | 2 |  |  |  | A request that leaves the server is what end to end is for. |
| `when.spec.ts` | 7 | move |  | 5 |  | 2 |  | The rule in words is Settings; who may set it is the route. |
| `words.spec.ts` | 4 | move |  | 1 |  |  | 3 | The send hint is `mod-key`, which already has unit tests. |
| **80 files** | **460** | | **86** | **254** | **9** | **108** | **3** | |
