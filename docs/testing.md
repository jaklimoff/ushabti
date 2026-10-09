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
`commands.touch(true)` makes the page a touch screen, which answers
`(hover: none)` as `hasTouch` did end to end; turn it off after. A route
pushed is written in `pushed` of `src/test/next-navigation.ts`.

The task panel reads and writes more than the board. `serving()` in
`src/test/panel.ts` answers it: the tasks, their comments, checklists and
feed, a set and an archive of picked cards, and a new option, with a text save refused by 409 when its base moved, as the routes
refuse it. `wrote()` puts somebody else's save in first. `hear()` from
`renderWithBoard` is another tab speaking on the stream, for a face or an
editing sign.

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
may later be folded into one walk. The totals leave 92 tests end to end, and
the walks still to be written for the main flows bring it to about 100, on
four workers at most.

| Spec | Tests | Plan | Stays | Component | Unit | Route | Drop | Why |
| --- | --: | --- | --: | --: | --: | --: | --: | --- |
| `account.spec.ts` | 8 | move | 1 | 6 |  | 1 |  | Each face and password box is a component; one walk keeps the menu route and the board following the name. |
| `agent-face.spec.ts` | 2 | done (USH-269) |  | 1 |  | 1 |  | Who may change a face is the route's answer; the typed emoji is the box. |
| `agent-rename.spec.ts` | 2 | done (USH-269) | 1 |  |  | 1 |  | The watcher waking on the new name needs the stream and the harness. |
| `agent-rules.spec.ts` | 2 | done (USH-269) |  | 1 |  | 1 |  | The claim carrying the rules is a route; the closed tab is `pagehide` on the box. |
| `agents.spec.ts` | 17 | done (USH-269) | 3 | 2 | 2 | 10 |  | Tokens, beats, the lease and the refusals are route answers. Keep the first run on the board, the drag that takes over, and the silent run that closes itself. |
| `archive-retry.spec.ts` | 2 | done (USH-277) |  |  |  | 2 |  | Both are what a second archive writes. The file is gone; they are `archive-route.test.ts`. |
| `archive.spec.ts` | 12 | done (USH-277) | 2 | 9 |  | 1 |  | Keep archive and put back from the panel, and the archive page. The panel's races are component tests with a held answer. The column sweep is a component test and not a route one: what it writes is the bulk archive route `pick-route.test.ts` already holds, and what is left is the question and the toast (USH-277). |
| `ask-mail.spec.ts` | 1 | keep | 1 |  |  |  |  | Mail runs on the server's environment. |
| `attachments.spec.ts` | 2 | done (USH-282) | 1 | 1 |  |  |  | An upload through the bucket stays; the 503 sentence is Settings drawing an answer. It went to `ProjectPanel.test.tsx`; the 503 itself was already `attachments-route.test.ts`. |
| `bad-id.spec.ts` | 2 | move |  |  |  | 2 |  | `readId` already has unit tests; one route test per door says the sentence. |
| `blockers.spec.ts` | 4 | move |  | 3 |  | 1 |  | Being over takes the chain off is the board read; the rest is the panel. |
| `board.spec.ts` | 36 | done (USH-270) | 17 | 19 |  |  |  | Keep the first walk, the four pointer drags, the two keyboard drags, the copy link, the counts, an order across a reload, the finger and the drop onto a folded column. The plan kept 14, but ten tests carry `@smoke` and stay, and the fold's drop is a drag across columns, so its fold half went down alone and its drop stayed. The phone move and the title saved on a closed tab need nothing a component lacks: `pagehide` is counted there, which end to end could not. The small-tablet tests went down, and the builder rule that names them moved with them. |
| `cadence.spec.ts` | 7 | move | 1 | 4 |  | 2 |  | Keep shipping the last sprint. The layout rows are Settings drawn at two widths. |
| `card-view.spec.ts` | 10 | done (USH-271) | 1 | 9 |  | 1 |  | Keep the drag in Settings that moves the card, the panel and the list. The page and the board share one store in a component test, so a change reaches the card at once. A view's own card view also has a route half: the body with no rows is refused. |
| `changed.spec.ts` | 4 | move |  | 1 |  | 3 |  | What moves the changed time is the server's write. |
| `changelog.spec.ts` | 6 | move | 1 | 1 |  | 4 |  | Keep one shipped walk. Public, private and the token are route answers. |
| `close-sprint.spec.ts` | 1 | move |  |  |  | 1 |  | What a close archives is a route answer. |
| `collaboration.spec.ts` | 9 | done (USH-282) | 7 | 1 |  |  | 1 | Two people on one board is what end to end is for. The member list is a component; the shared Me is `applyFilters`. The plan had a unit test for Me, but `filters.test.ts` already holds it, the seed of a task added under it too, so the test was dropped. |
| `comment-delete.spec.ts` | 1 | done (USH-272) |  | 1 |  | 1 |  | Who may delete is a route answer. The question went to the comment component tests as a test of its own, the screen half of the same e2e test. |
| `comment-edit.spec.ts` | 7 | done (USH-272) | 2 | 4 |  | 1 |  | Keep the save that crossed a newer one. The box's keys and its closed tab are the component. The plan kept 1, but the walk that edits and reaches the other panel carries `@smoke` and stays. |
| `composer.spec.ts` | 2 | done (USH-271) |  | 2 |  |  |  | How the composer grows is layout, which Browser Mode has. |
| `done-when.spec.ts` | 6 | move |  | 1 |  | 5 |  | What frees a blocker and what Ship archives are server answers. |
| `drop-hidden.spec.ts` | 13 | done (USH-277) | 1 | 6 |  | 6 |  | Keep the writes that land at once. The questions are the panel and the bar; the drops are the routes. A rule written in Settings is a component test: its drop is the routes' and already held there, and what is left is the question with the count (USH-277). |
| `editing-sign.spec.ts` | 2 | done (USH-272) | 1 | 1 |  |  |  | Keep two editors on one task. The phone line is layout; the other tabs speak through the stubbed stream. |
| `editor-open.spec.ts` | 3 | keep | 2 | 1 |  |  |  | Which chunk loads when needs the production build. |
| `ended-sprint.spec.ts` | 5 | move |  | 2 | 1 | 2 |  | The header is a component; the read that writes nothing is a route. |
| `export.spec.ts` | 1 | done (USH-282) |  | 1 |  | 1 |  | Who may download is a route answer. The test also has a screen half, the member who sees no Download, which went to `ProjectPanel.test.tsx`. The file is gone. |
| `filters.spec.ts` | 12 | done (USH-282) | 8 |  |  | 4 |  | Moved 14 to `Filters.test.tsx` in USH-268. The four that call the API go to route tests. Keep the reloads, the closed tab, the two tabs, the deleted option and the zones. The four went to `lens-route.test.ts`. |
| `forgot.spec.ts` | 1 | keep | 1 |  |  |  |  | Mail runs on the server's environment. |
| `former.spec.ts` | 3 | move |  | 1 | 1 | 1 |  | `personOf()` and the board read answer for somebody who left. |
| `github-step.spec.ts` | 3 | keep | 3 |  |  |  |  | A script against a real server; nothing smaller runs it. |
| `import.spec.ts` | 4 | done (USH-282) | 1 | 1 |  | 2 |  | Keep one Trello file through the page. The phone is `ImportPanel.test.tsx`, drawn from the planner's own preview of the same file. |
| `iteration.spec.ts` | 3 | move | 1 | 2 |  |  |  | Keep the walk from grouping to the roadmap. |
| `links.spec.ts` | 2 | done (USH-272) |  | 2 |  |  |  | The panel and the card draw a link. |
| `list.spec.ts` | 19 | done (USH-271) | 4 | 14 |  | 1 |  | Keep the drag the board sees and the order across a reload. The rest is what a list draws. The plan kept 2, but three tests carry `@smoke` and stay, beside the order across a reload. The property a list no longer pins is the route's answer; a view that changes kind and a list on a project with nothing to group by have a route half too. |
| `listening.spec.ts` | 12 | done (USH-269) | 5 | 2 |  | 5 |  | Keep the stream, the watcher and the harness. The feed and its pages are route answers. The two bursts stay, because the watcher is what they check; they archive 210 cards rather than 300, one page and a bit, and the first waits on the watcher's `--state` file instead of three seconds (USH-283). |
| `live-preview.spec.ts` | 16 | done (USH-272) | 1 | 15 |  |  |  | The editor is a component with real layout; keep the chunk fetched as the panel opens. |
| `long-title.spec.ts` | 1 | done (USH-271) |  | 1 |  |  |  | A card clamped to three lines is layout. |
| `mail.spec.ts` | 1 | keep | 1 |  |  |  |  | Mail runs on the server's environment. |
| `markdown-wrap.spec.ts` | 2 | done (USH-271) |  | 2 |  |  |  | Wrapping is layout. The description and the comment arrive written; typing them is the panel's own test. |
| `mention.spec.ts` | 4 | done (USH-272) |  | 4 |  |  |  | The @ list is a component. |
| `option-dates.spec.ts` | 12 | done (USH-275) |  | 11 |  | 4 |  | The boxes and their closed tab are Settings; who may write is the route. Three tests also have a screen half: the multi-select with no boxes, the member who sees no Unship, and the select dated before. The file is gone. |
| `option-names.spec.ts` | 6 | done (USH-275) | 1 | 2 |  | 3 |  | Keep two creates at once, which needs the real database. |
| `panel-a11y.spec.ts` | 6 | done (USH-272) | 1 | 5 |  |  |  | Focus and roles are what a component test reads best. The plan moved all six, but the view strip's test carries `@smoke` and stays. |
| `parents.spec.ts` | 3 | move |  | 2 |  | 1 |  | One level deep is the server's rule. |
| `password-fill.spec.ts` | 3 | move |  | 3 |  |  |  | A value with no event is a box. |
| `pick-labels.spec.ts` | 3 | done (USH-273) |  | 2 |  | 1 |  | The bulk route keeps what it did not change. The bar went to `Pick.test.tsx`, the route to `pick-route.test.ts`, and the file is gone. |
| `pick.spec.ts` | 18 | done (USH-273) | 1 | 13 |  | 4 |  | Keep one Set on several cards. The 500s and the refusals are route answers. The three 500s, the refused batch among them, went to `pick-route.test.ts` (USH-283), and the agent's refused archive after them. The list under a finger turns on Chromium's touch emulation, as `hasTouch` did. |
| `presence.spec.ts` | 4 | done (USH-282) | 2 | 1 |  | 1 |  | Two people and a dying tab need the stream. The phone's faces went to `Presence.test.tsx`, spoken through the stubbed stream, and the agent's refusal to `presence-route.test.ts`. |
| `progress.spec.ts` | 4 | done (USH-275) |  | 3 |  | 2 |  | `progressOf` sums the bar; the header is a component. The plan had a unit test, but `progress.test.ts` already holds the sum, so the unit-count test went to the header with the phone width; the unit picked is also kept by the route. The file is gone. |
| `project-waiting.spec.ts` | 2 | done (USH-269) | 1 |  |  | 1 |  | Keep the count that changes live. |
| `properties.spec.ts` | 13 | done (USH-275) | 2 | 10 |  | 8 |  | Keep making a property and grouping a board by it. The plan kept 1, but the rename of an option carries `@smoke` and stays. Seven component tests that went by a reload have a route half that says what was kept, and the `showOnCard` test went to the route alone. |
| `rank.spec.ts` | 1 | done (USH-283) |  |  |  | 1 |  | The mend is the create route; `rank.ts` already has unit tests. It went to `rank-route.test.ts`. |
| `rate-limit.spec.ts` | 1 | move |  |  |  | 1 |  | The limit is the route's answer. |
| `reset.spec.ts` | 3 | keep | 1 |  |  | 2 |  | Keep the link that works once and signs in. Its count of controls on a dead page reached into the dev server's own shadow root and found Next's button; it asks the document now (USH-283). |
| `reveal.spec.ts` | 2 | move |  | 2 |  |  |  | The eye is a box. |
| `roadmap.spec.ts` | 6 | move |  | 4 | 2 |  |  | `roadmapRows()` says where a bar starts; the rest is the canvas. |
| `roles.spec.ts` | 3 | move |  | 1 |  | 2 |  | The role rule is the route's; the question before Make owner is a row. |
| `run-history.spec.ts` | 2 | done (USH-269) |  | 1 |  | 1 |  | Paging is the route; the panel draws the pages. |
| `search.spec.ts` | 6 | done (USH-273) | 2 | 4 |  |  |  | The box and its list; `searchTasks()` already has unit tests. The plan moved all six, but the two that find by title and by key carry `@smoke` and stay. |
| `select-menu.spec.ts` | 3 | done (USH-273) |  | 3 |  |  |  | The menu is a component. A reload there is the server's copy here, drawn again. The file is gone. |
| `settings-controls.spec.ts` | 6 | move |  | 6 |  |  |  | Sizes and colours are what a component test measures. |
| `settings-load.spec.ts` | 4 | move | 1 | 1 |  | 2 |  | Keep a change by somebody else reaching Settings. |
| `settings-select.spec.ts` | 4 | move |  | 4 |  |  |  | The menu is a component. |
| `settings.spec.ts` | 21 | move | 2 | 17 |  | 2 |  | Keep the invite that joins on sign-up and the main view the board opens on. |
| `ship.spec.ts` | 6 | move | 1 | 3 |  | 2 |  | Keep Move, which archives and moves on. |
| `shipped-iteration.spec.ts` | 5 | move |  | 3 |  | 2 |  | What leaves the board is the read; the fold is Settings. |
| `sprints.spec.ts` | 4 | move | 2 |  |  | 2 |  | Keep the two migrations, which need the real database. |
| `stamps.spec.ts` | 3 | done (USH-282) | 1 | 1 |  |  | 1 | Keep server and browser reading the same day. The plan had a unit test for the order by Updated, but `stamps.test.ts` and `sort.test.ts` already hold it and the press on a heading, so it was dropped. |
| `switcher.spec.ts` | 6 | done (USH-273) |  | 6 |  |  |  | The switcher is a menu. Where a press went is the link it followed or the route it pushed, not the next page. The file is gone. |
| `task-keys.spec.ts` | 1 | done (USH-272) |  | 1 |  |  |  | A key in Markdown is the page's rule. |
| `text-save.spec.ts` | 5 | done (USH-272) |  | 4 |  | 1 |  | A conflict is a 409 the fake can answer. A tick and a value refusing nothing is the route. |
| `type-defaults.spec.ts` | 7 | move |  | 3 |  | 4 |  | What a create starts with is the route's answer. |
| `types.spec.ts` | 4 | move |  | 3 |  | 1 |  | The Types page is a component. |
| `undo-delete.spec.ts` | 8 | done (USH-277) | 1 | 3 |  | 4 |  | Keep the delete that comes back whole. |
| `upload.spec.ts` | 4 | done (USH-282) | 2 | 2 |  |  |  | Keep the two uploads through the bucket. The description's drop and the stopped upload's line went to `Upload.test.tsx`, with the bucket answered in the page. |
| `waiting.spec.ts` | 4 | done (USH-269) | 1 | 3 |  |  |  | Keep an answer from the list. Its tasks and agent are made by the routes, not the composer and Settings (USH-283). |
| `webhooks.spec.ts` | 6 | done (USH-282) | 4 | 2 |  |  |  | A request that leaves the server is what end to end is for. The dev server runs in Docker, so the receiver is called by `host.docker.internal` there, and the queued delivery of a webhook that is off waits on a second webhook that rings instead of 1.2 seconds (USH-283). The refused URL and the phone call nothing, and went to `WebhooksPanel.test.tsx`. |
| `when.spec.ts` | 7 | done (USH-275) | 1 | 5 |  | 2 |  | The rule in words is Settings; who may set it is the route. The plan moved the race of two rules, but it stays: the in-memory database of a route test answers one request at a time, so it cannot lose the race the project lock is for. |
| `words.spec.ts` | 4 | done (USH-273) |  | 1 |  |  | 3 | The send hint is `mod-key`, which already has unit tests. The one word for each idea went to `Pick.test.tsx`, and the file is gone. |
| **80 files** | **460** | | **94** | **254** | **6** | **116** | **5** | |
