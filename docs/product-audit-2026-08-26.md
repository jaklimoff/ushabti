# Product audit — Ushabti

**Date:** 2026-08-26 · **Version audited:** 0.5.0 (`686080a`) · **Auditor:** Product Owner review

---

## 1. Executive summary

Ushabti is a self-hosted task board whose one idea — every field on a task is a property you
define — is fully delivered in code, not just in the README. The engineering is better than the
version number suggests: 85 unit tests, 48 end-to-end tests that run against the production build,
zero `TODO`/`@ts-ignore`/`eslint-disable` in the whole repository, one consistent error shape across
all 37 API routes, and a 30-page documentation site. The agent protocol — humans and machines as
rows in the same `users` table — is a real differentiator and is documented better than most
commercial products manage.

The problem is not quality. It is that this product has never met a second person. First commit was
four days ago, there are five releases, zero stars, zero issues and one contributor. Every gap that
matters is at a seam a solo author never crosses.

Three of those seams are broken today, and none of the three is on the roadmap. **Inviting a
teammate deadlocks**: the owner is told "ask them to register first", the teammate is told "ask the
owner to add you", and with `USHABTI_SIGNUP=closed` — the setting the self-hosting guide tells you
to switch on — nobody can break the circle without editing `.env` and restarting. **Finding your own
work hijacks everyone else's board**: filters live on the shared view row and broadcast live, so a
member who filters to their own name re-filters the board for the whole team within a second.
**Pause never completes**: the shipped agent client cannot send the status that clears a pause
request, so the flagship control surface hangs on "It answers on its next report" forever.

Fix those three and the roadmap's own ordering is sound. Ship them before search and sorting, which
are currently next in line. The security items under "Before anyone else runs this" are correctly
identified and correctly deferred behind a reverse proxy — with one exception: a self-hosted product
that auto-applies migrations on every container start needs a backup and rollback story before it
needs anything else on that list.

---

## 2. Product understanding and assumptions

**What it is.** A small, fast, self-hosted task board that looks like Trello, in which no task field
is hardcoded — Status and Priority are ordinary rows a user can rename or delete. A view is a board
grouped by one of those properties. Humans and AI agents are members of the same project, use the
same JSON API, and appear in the same activity log.

**The job it is hired to do.** For a crew of three to twenty: hold what must be done, who does it,
and what is finished — shaped to how *this* team works rather than to a vendor's fixed spine, on
their own hardware, permanently free.

**Primary user.** The person who self-hosts for a small team, and who is also the project owner.
They are technical enough for `docker compose up`. They chose this over Trello because their
workflow does not fit a fixed spine, or because they want their data in their own Postgres, or
because they want agents on the board.

**Second primary user — unusual and worth naming.** The AI coding agent. The product treats it as a
user to be onboarded, not an integration surface: it gets a token, a shipped skill file served by the
board itself, and a documented run protocol. Claude Code specifically.

**Secondary users.** Ordinary team members with no admin rights; contributors to the open-source
project.

**Product stage.** Late prototype, presented as a mature product. The engineering apparatus is
running years ahead of the product's actual age — tag-gated releases that refuse to publish on a
changelog mismatch, multi-arch images with provenance attestation, CodeQL, Dependabot auto-merge,
seven CI workflows. The product itself has never survived contact with a stranger.

**What success plausibly means now.** Not more features. **Ten unrelated teams install it and still
use it a month later.** Every recommendation below is scored against that.

### Working assumptions

1. The goal is adoption by real outside teams, not a personal tool that happens to be public. The
   README, the docs site, the Docker Hub publishing and the CODE_OF_CONDUCT all imply this.
2. There is one maintainer with limited hours. Effort estimates matter more than they would on a
   funded team.
3. The declared non-goals are firm and I should not relitigate them.
4. "Small by intent" is a real constraint, not a slogan. I have recommended nothing that adds a
   configuration surface or a second concept where one would do.
5. Self-hosters run behind a reverse proxy, as SECURITY.md instructs. I have therefore not treated
   the missing rate limit as the top item — but see §4 for where that reasoning stops.
6. No revenue model exists or is wanted. "Actually free, no cloud edition" is a positioning
   commitment, so growth is the only meaningful return on this work.

---

## 3. Feature inventory

Grouped by user-facing capability. Confidence is my confidence in the status, not in the code.

| Capability | Status | Evidence | Confidence |
| --- | --- | --- | --- |
| Sign up / sign in | done | scrypt + `timingSafeEqual` `src/lib/auth.ts:19-32`; DB sessions `:33`; `USHABTI_SIGNUP` gate `:73` | High |
| Password reset | **missing** | No email anywhere in the product; stated in `SECURITY.md` | High |
| Account self-service | done | name, palette colour, password, end other sessions — `src/components/account/Account.tsx`, `api/auth/sessions` | High |
| Projects | done | create with defaults `src/lib/queries.ts:85-137`; rename, key, delete-with-typed-key | High |
| Custom properties (7 types) | done | `src/lib/types.ts:1-11`; coercion `src/lib/values.ts:30-76`; create/rename/recolour/reorder/show-on-card | High |
| Property reorder | partial | ↑/↓ buttons only, not drag — `PropertiesPanel.tsx:180-196`; roadmap "Next" #5 | High |
| Views (grouped boards) | done | groupable types restricted to select/person/checkbox `types.ts:34` | High |
| Filters within a view | done | `src/lib/filters.ts`, 12 operators, self-healing reads, 48 unit tests | High |
| Filters — per-user | **missing** | Filters are on the shared `views.config` row and broadcast — see §4 | High |
| Sorting within a view | **missing** | One global `tasks.position`; roadmap "Next" #1 and "Known limits" | High |
| Board, columns, drag and drop | done | custom collision `BoardCanvas.tsx:788`; one write per drag | High |
| Keyboard board control | done | single tab stop, arrow cursor, Space-lift drag; 3 e2e tests | High |
| Global keyboard shortcuts (`n`, `/`) | **missing** | roadmap "Next" #3 | High |
| Task detail, markdown, checklist | done | `TaskPanel.tsx`; DOMPurify-gated markdown `Markdown.tsx:39` | High |
| Comments | partial | add + delete; **no markdown rendering** (`TaskPanel.tsx:822` renders raw), no edit, no mentions | High |
| Activity log | partial | written for 8 kinds; **read per-task only**, last 60 (`queries.ts:378`). No project feed | High |
| Task search | **missing** | Nothing. The `filter-search` testid is a property typeahead, not task search | High |
| Members | partial | add-by-existing-email only; **onboarding deadlocks — see §4** | High |
| Roles | partial | owner/member only; role never editable after insert; **no ownership transfer** | High |
| Agents as members | done | `users` row, `kind='agent'`; token, skill, Connect recipe with live "answered" poll | High |
| Agent runs (claim/report/beat/close) | done | full protocol; beat vs report distinction correct `runs.ts:270-276` vs `:88-92` | High |
| Agent Stop / Take over | done | `control/route.ts`; drag-to-take-over; exit code 9 | High |
| Agent **Pause / Resume** | **broken** | shipped client never sends `status`; `obeys()` never clears — see §4 | High |
| Run history | **missing** | closed runs keep rows; every reader filters `isNull(endedAt)` `runs.ts:110,150` | High |
| Live updates (SSE) | done | Postgres LISTEN/NOTIFY, 140 ms debounce, re-sync on connect `store.tsx:194-197` | High |
| Webhooks / outbound | **missing** | no outbound call anywhere; roadmap "Before anyone else runs this" | High |
| Destructive-action confirms | partial | `ConfirmRow` everywhere **except task delete and option delete** — see §4 | High |
| Settings (4 pages) | done | addressable, blur-to-save, rail with counts | High |
| Agent tokens | done | `ush_` prefix, SHA-256 digest, shown once, revocable, throttled `last_used_at` | High |
| Token expiry | **missing** | no `expiresAt` column; a leaked token is valid until noticed | High |
| Rate limiting | **missing** | none anywhere; documented in `SECURITY.md`, mitigated by proxy | High |
| Logging / health / metrics | **missing** | one `console.error` total (`api.ts:23`); no health endpoint | High |
| Migrations | done | 3 generated files; auto-applied on container start (`Dockerfile` CMD) | High |
| Migration rollback / backup guidance | **missing** | no down-migrations, no restore doc — see §4 | High |
| Mobile / narrow screen | partial | panel overlays below 900 px; no phone board layout | Medium |
| Archive, undo, bulk edit, attachments, import, list view, blocked-by | **missing** | all roadmap "Later" | High |

### Deliberately out of scope — do not recommend

From `website/.../start/what-it-is.mdx:68-69` and scattered declarations: sprints, burndown charts,
a workflow engine, a plugin market, per-field or per-task permissions, a cloud edition, **email of
any kind** (no invites, no reset, no notifications), a configuration file, per-view card order,
multi-select as a grouping property, enforceable (non-cooperative) Pause/Stop, a second agent
identity table, dialogs on the board, and any hardcoded task field — the last being the one
inviolable rule of the codebase.

> **Documentation contradiction to settle.** `what-it-is.mdx:68` lists "no import from Jira" as a
> permanent non-goal. `ROADMAP.md` "Later" lists "**Import.** Read a Trello or Jira export and map
> lists to options." A prospective adopter gets opposite answers. Pick one.

---

## 4. Gap analysis

### Missing

**M1 — There is no way to give a teammate an account. (Blocker.)**
Only two code paths insert a human user: `POST /api/auth/register`, gated by `signupIsOpen()`, and
agent creation (which sets `passwordHash: null`). The owner's "add member" route requires the account
to exist already. So the two failure messages point at each other:

- `api/projects/[projectId]/members/route.ts:18` — *"No account uses that email. **Ask them to
  register first.**"*
- `api/auth/register/route.ts:10` — *"This board is not taking new accounts. **Ask the owner to add
  you.**"*

With `USHABTI_SIGNUP=closed` this is a closed loop with no exit inside the product. The owner has no
UI, no route and no script to create an account. The only escape is editing `.env` and restarting
the container — which means reopening the instance to the internet during onboarding, precisely the
risk the setting exists to remove. Worse, the People page still offers a copyable `/register` link
(`PeoplePanel.tsx:140`) that leads to the dead-end page, and `configuration.md` claims *"the owner
can still add members by email"*, which is only true for people who already have accounts.

*Why it is expected:* the product's stated user is a **team**. *What happens without it:* the
second person never gets in. The core promise fails at the first attempt, and the docs told the
owner to configure it this way.

**M2 — There is no per-user view state, so "find my work" is destructive.**
Filters are stored on the shared view row (`views.config.filters`, `schema.ts:235-239`), written by
`PATCH /api/views/{id}` and broadcast to every open board (`views/[viewId]/route.ts:64`). A member
who filters `Assignee is Bob` to see their own tasks re-filters the board **for the whole team,
live, within a second**. `store.setFilters` writes on the first ticked value — no draft, no undo.
Two people on one view fight in real time. The only per-user state in the entire product is which
view is selected (`store.tsx:107`).

The roadmap frames this as "a filter that says *me*" under **Later**. That understates it: the
missing thing is not a keyword, it is any notion of a personal lens. Combined with **M3**, a team
member has no non-destructive way to answer "what am I supposed to be doing?"

**M3 — No task search.** Roadmap "Next" #2, correctly placed. Without it, and without sorting, a
board past a hundred cards is navigated only by eye.

**M4 — No backup or rollback story for auto-applied migrations.**
The production image runs `node scripts/migrate.mjs && node server.js` on **every container start**.
There are no down-migrations, no rollback script, no restore procedure, and no backup guidance in
`docker-compose.prod.yml` or the self-hosting docs. A bad `:edge` image — and `:edge` is the default
tag in `docker-compose.prod.yml` — restarts and migrates before an operator can intervene. For a
self-hosted product this is the single largest operational risk, and it is the one item in this
report that can lose a user's data permanently.

**M5 — No diagnosability.** One `console.error` in the entire application (`api.ts:23`). No logger,
no request log, no log level, no correlation id, no metrics, no tracing, no `instrumentation.ts`,
and **no health endpoint** — `docker-compose.prod.yml` health-checks the database only. A container
whose pool is exhausted or whose SSE `LISTEN` client has died looks healthy to Docker, to a proxy,
and to Kubernetes. When a stranger's instance misbehaves, neither they nor the maintainer has any
evidence to work from. That directly costs bug reports, which at this stage are the scarcest input.

**M6 — No ownership transfer and no third role.** `project_members.role` only ever receives
`"owner"` at creation and `"member"` on add; no route updates it. An owner can delete the project
but never hand it over. If the person who ran `docker compose up` leaves the company, the project is
stranded.

### Incomplete

**I1 — Pause is broken end to end, in the flagship feature.**
`obeys()` (`api/runs/[runId]/route.ts:133-138`) clears a `pause` control word only when the agent
reports `status: "paused"`. The shipped client builds its report from `--say/--log/--index/--plan`
and **never sends `status`** (`board.mjs:385-392`). So:

- The person presses Pause; the panel says *"Asked the agent to pause. It answers on its next
  report."* and never stops saying it.
- `SKILL.md:66-67` instructs the agent to *"poll `task USH-14` until the run is gone or the pause
  clears"* — but `board.mjs task` prints `run {id} — {name}, {status}` and **never prints
  `control`** (`board.mjs:269`). The documented polling loop cannot observe the thing it polls for.
- `SKILL.md:62` tells the model `control` is only ever `none | pause | stop`. `resume` is a real
  value (`types.ts:194`) and will be printed. The model has no instruction for it.

The raw HTTP protocol is correct and `docs/agents.md` documents it correctly. The break is entirely
in the shipped client and skill — the layer every real agent will actually use. Stop and Take over
work; Pause and Resume do not. *Finished looks like:* `step` accepts `--status`, `task` prints
`control`, `SKILL.md` covers `resume`, and an e2e test drives pause → resume to completion.

**I2 — The "no destructive action on one click" rule has two holes, and the changelog denies it.**
`ConfirmRow` is used for properties, views, members, agents, tokens and the project. It is **not**
used for:

- **Task delete** — `TaskPanel.tsx:172-181` deletes immediately and closes the panel. This is the
  most valuable object in the product and the only one with no undo and no confirm.
- **Option delete** — `PropertiesPanel.tsx:295` calls `deleteOption(option.id)` straight from
  `onClick`, while property delete two hundred lines earlier uses `ConfirmRow` properly (`:137`).

Both `CHANGELOG.md` (0.3.0) and `ROADMAP.md` (v1.1) explicitly claim deleting **an option** now asks
first. It does not. The docs site already caught this and says so aloud
(`guides/settings.mdx:41-43`). Shipping a changelog that claims a safety feature the code lacks is
worse than the missing feature.

**I3 — Removing an agent silently destroys its history while promising the opposite.**
The confirmation says *"Its comments and its activity stay."* (`PeoplePanel.tsx:332`). In fact
`agent_runs.agentId` is `onDelete: cascade` (`schema.ts:293-295`), so every run, step and log row is
deleted; comments become "Removed user"; activity lines become "Someone made a change". Three
different foreign-key behaviours, one sentence, none of them accurate.

**I4 — Activity is written but barely readable.** Rows carry `project_id` and there is an
`activity_project_idx`, but **nothing reads activity by project** — the index earns nothing. Worse,
`kind: "deleted"` rows are written with `taskId` null (`api/tasks/[taskId]/route.ts:61-67`) while the
only reader filters by `taskId`, so they are unreachable by any UI, and `describeActivity` has no
branch for them. Write-only data. There is no "what changed while I was away" anywhere.

**I5 — Comments are a second-class surface.** Rendered as raw text while descriptions get markdown;
no editing; no mentions. The composer placeholder becomes *"Leave a note for the agent…"* when a run
is open, implying the agent reads comments — nothing delivers them, and the agent has no unread
state. That is a promise the system does not keep.

**I6 — Removing a member orphans their values.** Only the `project_members` row is deleted. Their
user id stays in `task_values` for every person property, and the card then renders no avatar at all
(`TaskCard.tsx:60-64`) — silently losing the assignment with no "unassigned" signal.

### Improve

**P1 — Destructive routes are the untested ones.** No test imports a `route.ts` at all; there are no
integration tests. Uncovered end to end: task delete, comment delete (including its author-or-owner
branch), checklist delete, member removal (the whole authorization ladder), agent removal (including
the 409-if-running branch), sign-out-everywhere, and `GET /skill/[file]` — which depends on a
hand-maintained `outputFileTracingIncludes` entry and is exactly the class of thing that breaks
silently in the production image. Delete paths are where data loss lives.

**P2 — `src/lib/auth.ts`, `values.ts` and `agents.ts` have no unit tests.** These are password
verification, the entire user-defined type system, and token parsing. A regression in the
`scrypt$salt$key` parse could silently return `false` — or, in the wrong direction, accept.

**P3 — `board.mjs` refetches the whole board on every command.** Each command is a fresh process, so
a ten-step run makes twenty-plus full-board fetches, each pulling every task, every value and every
open run. `claim` prints a run id that no other command accepts.

**P4 — No security headers.** `next.config.mjs` defines no `headers()` — no CSP, no
`X-Frame-Options`, no HSTS, no `Referrer-Policy`. With a `dangerouslySetInnerHTML` in the app (well
guarded, but present), a CSP is meaningful defence in depth.

**P5 — Unbounded growth in three places.** Expired session rows are never swept; the activity table
grows forever; tokens never expire. All slow, all real.

**P6 — Two input-validation gaps.** Bulk option creation caps the count at 40 but applies **no
length cap per name**, while the single-option route caps at 40 characters — so a 10 MB option name
is storable through one path and rejected through the other. And the `values` object on task
create/move has no key-count cap, making an unbounded query loop over caller-supplied input.

**P7 — Discoverability of filters.** Nothing on an unfiltered board suggests filters exist; the
button sits at the far right of the view strip and the chip row only renders once a rule exists.

**P8 — No duplicate-name check on properties or options.** `board.mjs findProperty` matches by
lowercased name and silently takes the first, so an agent told to set "Status" on a board with two
Status properties writes to whichever sorts first.

**P9 — `infra/` sits in the working tree holding production secrets and two database dumps**
(`infra/.env`, `demo-accounts.txt`, `do-ca.crt`, `ushabti-2026-08-25.sql.gz`), protected only by
`.git/info/exclude` — a local, unshared, un-cloneable mechanism. `.gitignore` covers `.env` but not
the dumps, the accounts file or the CA certificate. One lost exclude file and a `git add -A` commits
production data to a public repository.

### Over-built or questionable

**O1 — Filters shipped before search and sorting.** Filters got an elaborate and genuinely excellent
semantics — `NO_VALUE_KEY` as a value rather than an operator, `hasAnswer()` gating, `allowedColumns()`,
`seedValues()`, self-healing reads — plus 577 lines of unit tests, more than any other module by a
wide margin. It is the best work in the codebase. It is also depth built before breadth: a user
cannot yet *find* a task or *order* a column, and the filter they do have re-filters everyone else's
board (**M2**). The sequencing served the interesting problem rather than the user's first hour.

**O2 — Release apparatus far ahead of product stage.** Provenance attestation, multi-arch native
runners, CodeQL, Dependabot auto-merge, cache pruning, and a release job that refuses to publish on a
changelog mismatch — for a project with zero external users. Defensible as a credibility signal for
an open-source launch and cheap to maintain, so I am not recommending removal. But it is the clearest
evidence that engineering instinct is currently outrunning product instinct, which is the same
instinct that produced **M1**, **M2** and **I1**.

**O3 — Two hand-maintained sources of truth for the agent protocol.** `docs/agents.md` (linked from
the README) and `website/src/content/docs/agents/*` duplicate each other, and have already drifted:
`docs/agents.md` omits `stopped` and `taken_over` from its status list, then uses
`report({ status: "stopped" })` in its own code sample two sections later. `website/scripts/sync.mjs`
already has the mechanism to make one file authoritative and is not used for this one.

**O4 — Dead code, small but real.** `optionById()` (zero call sites), `useElapsed()` (zero call
sites), `stepStates()` (referenced only by its own test, while production duplicates the logic in
`setCurrentStep()` — two implementations of one rule, one tested), `NO_VALUE` and `NO_VALUE_KEY` as
duplicate constants of the same string, `UserMenu`'s unused `extra` prop, and a `SESSION_SECRET` in
the local `.env` that nothing in the codebase reads (sessions are opaque DB rows; there is no JWT).

**O5 — README is a release behind its own product.** It never mentions filters — the entire 0.5.0
release, with a 164-line guide on the docs site. It also omits the run heartbeat and lease, and its
Tests section says e2e runs "against the dev server", contradicting the three other documents that
stress `CI` serves the production build.

**O6 — `ROADMAP.md` has no non-goals section, and four documents send readers to it for one.**
`AGENTS.md`, `CONTRIBUTING.md`, the docs site (*"it is the more useful half of that page"*) and the
feature-request issue template all point at a list that is not there — it lives in `what-it-is.mdx`.
Scope discipline is this project's main differentiator *and* its main contributor-management tool;
the canonical artifact for it is missing from the file everyone is told to read.

### One thing that is not a defect

Two of my discovery passes flagged that agents and plain members can **create** properties, options
and views, and can repoint a view's `groupById`, despite `AGENTS.md` saying "Structure is the
owner's". I checked: the code and the docs site agree precisely
(`guides/people.mdx:70-71` lists exactly these under "Any member"). `AGENTS.md` is accurate on
deletes; its summary line is just a loose slogan. **This is a deliberate, documented design, not a
bug.** The one edge worth a decision is that `PATCH /api/views/{id}` lets an agent token re-group the
shared default view for everyone — which reads as structure rather than content. That is a judgement
call for the owner, listed in §7, not a defect to fix.

---

## 5. Prioritized backlog

Scored for a single maintainer. Effort: S ≤ 1 day, M ≤ 3 days, L ≤ 1 week, XL beyond.

| # | Item | Impact | Conf. | Effort | MoSCoW |
| --- | --- | --- | --- | --- | --- |
| 1 | Owner can create an account | Critical | High | S | Must |
| 2 | Fix Pause/Resume in the shipped client | High | High | S | Must |
| 3 | Confirm before deleting a task or an option | High | High | S | Must |
| 4 | Personal filters | High | High | M | Must |
| 5 | Backup and rollback guidance | High | High | S | Must |
| 6 | Health endpoint and minimal request logging | High | High | S | Must |
| 7 | Task search | High | High | M | Should |
| 8 | Tests for the destructive routes | Med | High | M | Should |
| 9 | Fix the four false documentation claims | Med | High | S | Should |
| 10 | Sorting within a view | Med | Med | M | Could |

---

### 1. An owner can create an account for a teammate

**User story.** As the owner of a closed instance, I can create an account for a new teammate from
Settings → People, so that a person without an account can join without me reopening the instance to
the internet.

**Why now.** This is a total blocker on the product's core promise — a board for a *team* — and the
self-hosting guide actively instructs the configuration that triggers it. Every trialist who gets as
far as inviting their second person hits it. It is the highest-impact fix in this report and one of
the cheapest.

**Acceptance criteria**

- With `USHABTI_SIGNUP=closed`, an owner on Settings → People can create a member by name, email and
  an initial password, in one row, without a dialog.
- The new account can sign in immediately and lands on the project it was created for.
- The route is `ownerOnly()` and `humanOnly()`; an agent token receives 403.
- When the owner's "add by email" lookup 404s, the inline recovery offers **create the account**
  rather than a `/register` link that dead-ends under closed signup.
- `configuration.md`'s claim that "the owner can still add members by email" is corrected or made
  true.
- An e2e test closes signup, creates a member as owner, and signs in as them.

**Effort** S · **Risk** Low; one new owner-only route reusing `hashPassword`. It adds a password the
owner knows — note in the UI that the person should change it on `/account`. **Dependencies** None.
**Evidence** `api/auth/register/route.ts:10`, `api/projects/[projectId]/members/route.ts:18`,
`PeoplePanel.tsx:140`, `AuthForm.tsx:49`.

---

### 2. Pause and Resume complete through the shipped client

**User story.** As a person watching an agent work, when I press Pause the card tells me the agent
actually paused, and when I press Resume it goes back to work — using the client and skill the
product ships.

**Why now.** Agents are the headline differentiator and the reason someone picks this over Trello.
Two of the four controls are broken in the only client anyone will use, and the skill instructs a
polling loop that cannot observe what it polls for. Anyone who evaluates the flagship feature finds
it hanging.

**Acceptance criteria**

- `board.mjs step` accepts `--status` and forwards it, so an agent can report `paused` and
  `running`.
- `board.mjs task` prints the run's `control` word alongside its status.
- `SKILL.md` documents all four control values including `resume`, and its pause loop matches what
  the client can observe.
- Pressing Pause and then Resume clears the control word in both directions; the panel stops saying
  "It answers on its next report" once the agent has answered.
- An e2e test drives claim → pause → resume → finish to completion.

**Effort** S · **Risk** Low; the server protocol is already correct and needs no change.
**Dependencies** None. **Evidence** `board.mjs:385-392`, `:269`, `SKILL.md:62,66-67`,
`api/runs/[runId]/route.ts:133-138`, `types.ts:194`.

---

### 3. Deleting a task or an option asks first

**User story.** As anyone on the board, I cannot destroy a task or a property option with a single
misplaced click.

**Why now.** There is no undo and no archive, so both deletions are permanent. Task delete is the
only destructive action in the product with no confirmation, which contradicts the house rule in
`AGENTS.md` and `CONTRIBUTING.md`. And the changelog already claims option delete was fixed in
v1.1 — the promise has shipped, the behaviour has not.

**Acceptance criteria**

- Deleting a task asks in place, naming what goes with it in real numbers (comments, checklist
  items) in the style of the existing property confirmation.
- Deleting an option uses `ConfirmRow`, matching property delete in the same panel.
- No dialog is introduced; both use the existing `ConfirmRow`.
- `CHANGELOG.md` 0.3.0 and `ROADMAP.md` v1.1 are corrected, or the entry is moved under Unreleased
  as newly true.
- An e2e test covers both confirmations, including cancel.

**Effort** S · **Risk** Very low; `ConfirmRow` and `useConfirm` already exist and are used six times.
**Dependencies** None. **Evidence** `TaskPanel.tsx:172-181`, `PropertiesPanel.tsx:295` vs `:137`,
`guides/settings.mdx:41-43`.

---

### 4. A filter I set for myself does not change anyone else's board

**User story.** As a team member, I can narrow the board to my own work without changing what my
teammates see.

**Why now.** With no search and no sorting, filtering is the *only* way to find your work — and
doing it broadcasts to everyone within a second, with no draft state and no undo. Two people on one
view fight in real time. This is the friction that makes a shared board unusable on day two, and it
is the single largest daily-use gap.

**Acceptance criteria**

- A filter has a clear owner: either it applies only to me by default with an explicit "save to this
  view for everyone" action, or a personal filter layer sits on top of the shared one. Pick one
  model and make it visible in the chip row.
- A personal filter survives a reload and is stored per user per view.
- Setting a personal filter emits no broadcast to other members.
- The task count and `allowedColumns()` behaviour are identical for personal and shared filters —
  the same reading, per the existing design rule.
- Existing saved shared filters keep working unchanged.
- E2e: two browsers, one filters personally, the other's board is unaffected.

**Effort** M · **Risk** Medium. This is the one item with a real design decision inside it (see §7),
and `localStorage` would be the cheap route but loses the filter across devices. **Dependencies**
Decide the model before building; do not start this before §7 Q1 is answered. **Evidence**
`schema.ts:235-239`, `views/[viewId]/route.ts:47-64`, `store.tsx:107,433-439`.

---

### 5. A self-hoster knows how to back up and how to get back

**User story.** As someone running this for my team, I know how to take a backup, and if an upgrade
goes wrong I know how to return to a working state.

**Why now.** The production image applies migrations on **every container start**, and the default
tag is `:edge` — rebuilt nightly from `main`. There are no down-migrations and no restore
instructions anywhere. This is the only item in this report that can lose a stranger's data
permanently, and the fix is mostly writing.

**Acceptance criteria**

- The self-hosting page documents a `pg_dump` backup command against the compose service, and the
  matching restore.
- It states plainly that migrations apply automatically on start and that a backup should be taken
  before `pull`.
- `docker-compose.prod.yml` and the docs recommend pinning `USHABTI_VERSION` to a released tag for
  real use, rather than defaulting to `:edge`.
- The upgrade section names the rollback path: restore the dump, pin the previous tag.
- If a migration is not reversible, `CHANGELOG.md` says so in that release's notes.

**Effort** S · **Risk** Low; documentation plus a default change. Optionally add a `db:dump` script.
**Dependencies** None. **Evidence** `Dockerfile` CMD, `docker-compose.prod.yml`, `drizzle/`.

---

### 6. A running instance can be probed and a broken one leaves evidence

**User story.** As an operator, my proxy or orchestrator can tell whether Ushabti is actually
serving, and when something breaks there is something to read.

**Why now.** A container whose pool is exhausted or whose SSE `LISTEN` connection has died looks
perfectly healthy today — the only healthcheck is on Postgres. And a stranger who hits a bug has
exactly one un-timestamped `console.error` to send you. At a stage where bug reports are the
scarcest and most valuable input, having nothing to report is a growth problem, not just an ops one.

**Acceptance criteria**

- `GET /api/health` returns 200 with a database round trip and the app version, 503 when the pool
  cannot answer. It requires no auth and leaks nothing beyond liveness and version.
- `docker-compose.prod.yml` gives the `app` service a healthcheck pointing at it.
- The one `console.error` in `route()` gains a timestamp, the method, the path and the status.
- The self-hosting page says where logs go and how to read them (`docker compose logs`).
- Keep it to one endpoint and one log line — no logging framework, consistent with "small by
  intent".

**Effort** S · **Risk** Very low. **Dependencies** None. **Evidence** `api.ts:23`,
`docker-compose.prod.yml`, absence of `instrumentation.ts`.

---

### 7. Find a task by key or by words in its title

**User story.** As anyone on the board, I can press `/`, type, and jump to a task.

**Why now.** Roadmap "Next" #2, and correctly placed. Once **#4** stops filtering from being
destructive, search is the remaining half of "find my work". Below a hundred cards the board carries
it; above that, nothing does.

**Acceptance criteria**

- A box in the top bar matches on task key and on words in the title, results as you type.
- `/` focuses it; `Esc` closes it and returns focus to the board cursor.
- Choosing a result opens that task's panel, and works for a task hidden by the current filter.
- Search is scoped to the current project and respects membership.
- Results are capped and the query is indexed — do not add an unbounded scan to a board that already
  loads all its tasks at once.

**Effort** M · **Risk** Low to medium; keep it to `ILIKE` over title plus key rather than adding a
full-text stack. **Dependencies** Nothing hard, but ships better after #4. **Evidence** no search
route exists; `Filters.tsx:464` is a property typeahead.

---

### 8. The delete paths have tests

**User story.** As the maintainer, I can accept an outside pull request without personally checking
whether it destroyed data.

**Why now.** Every uncovered route is a destructive one, and the project is about to start taking
contributions from people whose judgement the maintainer cannot yet vouch for. `GET /skill/[file]`
in particular depends on a hand-maintained trace entry that `AGENTS.md` names as the top footgun in
the repository, and it is the endpoint every agent onboarding depends on.

**Acceptance criteria**

- Coverage for task delete, comment delete (both authorization branches), checklist delete, member
  removal (owner-cannot-leave, member-can, agent-cannot), agent removal (including the 409 while a
  run is open), and sign-out-everywhere.
- An e2e test fetches `/skill/SKILL.md` and `/skill/board.mjs` and asserts real content — running
  against the production build, where the trace entry actually matters.
- Unit tests for `hashPassword`/`verifyPassword` including a malformed stored hash, and for
  `coerceValue` across all seven property types including rejection cases.

**Effort** M · **Risk** Low. **Dependencies** Best done alongside #1, #2 and #3, which each add a
test anyway. **Evidence** no test imports any `route.ts`; `src/lib/{auth,values,agents}.ts` have no
test files.

---

### 9. The documentation stops claiming things that are not true

**User story.** As someone deciding whether to adopt this, the documents agree with each other and
with the product.

**Why now.** Honesty is explicitly part of this product's positioning — the roadmap names its own
limits, the filter design is built around telling the truth about what is hidden. Four false claims
undercut exactly that, and they are cheap to fix. One of them (option delete) claims a safety
feature that does not exist.

**Acceptance criteria**

- `CHANGELOG.md` 0.3.0 and `ROADMAP.md` v1.1 no longer claim option delete confirms — or #3 has
  shipped and the claim is moved to where it is true.
- The Jira import contradiction between `what-it-is.mdx:68` and `ROADMAP.md` "Later" is settled one
  way.
- `ROADMAP.md` gains the non-goals section that four other documents send readers to, or those four
  pointers are redirected to `what-it-is.mdx`.
- The README's feature list mentions filters, and its Tests section matches the other three
  documents on `CI` serving the production build.
- `docs/agents.md` is either deleted in favour of the docs site or added to `website/scripts/sync.mjs`
  so it cannot drift again; its run-status list is corrected to include `stopped` and `taken_over`.
- `ROADMAP.md`'s test counts are corrected (24/24 → 85/48) or the numbers are dropped.

**Effort** S · **Risk** None. **Dependencies** The option-delete line depends on #3.
**Evidence** §4 O5, O6, O3, and I2.

---

### 10. Sorting within a view

**User story.** As anyone on the board, I can order a column by a property rather than by where
cards happen to sit.

**Why now.** Roadmap "Next" #1 — the author's own top item, and I am deliberately demoting it. It is
real value, but it is the one item on this list that no one is blocked by: the board is usable
unsorted, whereas a team that cannot add its second member is not. Ship it once the seams are
closed.

**Acceptance criteria**

- A view can be ordered by any property, ascending or descending, plus the manual rank as today.
- The sort belongs to the view and saves like the grouping property does — and inherits whatever
  personal/shared decision #4 establishes.
- Manual drag stays available and is what "manual" means; the interaction says clearly when a drag
  will not stick because a sort is active.
- Empty values sort predictably and the rule is documented, consistent with the filter design's
  treatment of "nothing yet".
- Unit tests for the comparator across all seven property types.

**Effort** M · **Risk** Medium — it interacts with drag and drop, and with the one-card-order-per-
project limit the roadmap documents. **Dependencies** Decide #4's model first; sorting should not
ship shared-only and repeat M2's mistake. **Evidence** roadmap "Next" #1 and "Known limits".

---

### Quick wins

Items **1, 2, 3, 5, 6 and 9** are all S. Together they are roughly one focused week, and they
resolve both blockers, the broken flagship control, the two data-loss clicks, the operational risk
and every false claim in the documentation.

### Ordering and dependencies

- **#4 needs a decision before it needs code** (§7 Q1), and **#10 must not ship before #4** — a
  shared-only sort would repeat exactly the mistake filters made.
- **#9's option-delete line depends on #3.**
- **#7 lands better after #4**; both answer "find my work", and shipping search first leaves the
  destructive filter in place as the only way to narrow.
- **#8 is cheapest folded into #1, #2 and #3**, each of which adds a test anyway.
- Everything else is independent.

### Risks of not doing the top items

- **#1:** every team that tries to become a team fails, silently, after the owner followed the
  documentation. This is invisible to a solo maintainer and fatal to adoption.
- **#2:** the differentiator that justifies the product's existence appears broken to anyone who
  evaluates it.
- **#3:** a first-week user destroys a task by misclick, cannot undo, and leaves. There is no
  archive to fall back on.
- **#4:** the second and third members find the board unusable together and the team reverts to
  Trello — the one outcome the product exists to prevent.
- **#5:** a nightly `:edge` pull migrates badly and someone loses their data with no route back.
  That is the failure that ends an open-source project's reputation rather than just its momentum.
- **#6:** bugs found by strangers arrive unreportable and unreproducible, so they mostly do not
  arrive at all.

---

## 6. Suggested next two iterations

**Iteration one — make it survivable by someone who is not you.**

Every item in this iteration exists because the product has only ever been used by one person, and
each is small. Open by letting an owner create an account (#1): today the documentation walks a new
adopter into a locked room and hands them two error messages that point at each other. Then repair
Pause and Resume in the shipped client and skill (#2) — the server protocol is already right, so
this is an afternoon that restores the feature the product is named for. Put confirmations on task
and option delete (#3), which also lets the changelog stop claiming a safety feature that was never
built. Close with the operational floor: backup and rollback guidance plus a pinned version default
(#5), a health endpoint and a usable error line (#6), and a pass over the documents that corrects
every false claim (#9). Fold the delete-path tests (#8) in as you touch each route.

That is roughly a week, it is almost entirely S-sized, and at the end a stranger can install the
product, get their team into it, run an agent through a full control cycle, take a backup, and tell
you what broke. None of that is true today. This iteration adds no features — and that is the point.
The product does not have a feature problem.

**Iteration two — make it good on day two.**

Day one already works well; the board, the property model and the first-run path are genuinely
strong. Day two is where it fails, because the only way to find your own work is to change
everybody's board. So settle the personal-versus-shared question first (§7 Q1) and build personal
filters (#4), then put search behind `/` (#7). Those two together answer "what am I supposed to be
doing?" — the question a task board exists to answer and the one this board currently cannot.
Sorting (#10) follows naturally once the personal/shared model is settled, and inherits it rather
than repeating the mistake.

Only after those would I return to the roadmap as written. Sorting and search are already its next
two items, so this is less a redirection than an insertion: the seams first, then the roadmap. The
items I would keep deferring are archive, bulk edit, run history and the phone layout — all real,
none of them the reason a team would leave in week one.

---

## 7. Open questions for the product owner

1. **Are filters personal, shared, or both?** This blocks #4 and shapes #10. Three options: personal
   by default with an explicit "save for everyone"; a personal layer on top of a shared base; or
   shared-only with a per-user override. The second is the most powerful and the most code. My
   recommendation is the first — it matches "the composer says what it will write before it writes
   it" and needs no new concept. Related: should personal state live in the database (survives
   devices, one more table) or `localStorage` (free, per-browser, and the product already stores the
   selected view there)?

2. **Should an agent be able to re-group the shared default view?** Creating properties and options
   is documented as content and I would leave it. But `PATCH /api/views/{id}` with `groupById`
   re-columns the board for every human on it, and `filters` on that same route is already
   `humanOnly` for exactly this reason. Extending that guard to `groupById` is a two-line change.
   Your call whether it is structure.

3. **Does Ushabti import from Trello or Jira, ever?** `what-it-is.mdx` says never; `ROADMAP.md` says
   Later. Import is also the single strongest adoption lever an alternative-to-Trello product has, so
   this is a positioning decision, not a documentation cleanup.

4. **Is ownership transferable?** Today an owner can only delete the project. For a team tool, a
   maintainer leaving strands the board. Adding a role change is small; deciding whether "the owner"
   is a person or a permanent property of the project is not.

5. **What is the launch trigger?** The repository has zero stars and no external users, while the
   release apparatus is production-grade. If the plan is to post this somewhere, iteration one is
   the list of things that must be true first — particularly #1, which will otherwise generate the
   first issue filed by the first person who tries it.

6. **Should `USHABTI_SIGNUP=closed` be the default?** It is the safe posture for an instance with no
   rate limiting, but it is also what creates the deadlock. Once #1 ships, defaulting to closed
   becomes defensible and would meaningfully reduce the risk the missing rate limit carries.

7. **How much does the agent-facing client owe the agent?** `board.mjs` re-fetches the entire board
   on every command because each command is a new process. Is a persistent session or a run-id cache
   in scope, or is the current cost acceptable for boards of a few hundred cards?

---

## 8. Method and coverage

**Inspected.** Four parallel discovery passes over the repository at `686080a`, then direct
verification by me of every finding I ranked above the fold. Covered: `README.md`, `ROADMAP.md`,
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, the 30-page Astro docs
site under `website/src/content/docs/`, `docs/agents.md`; all 109 TypeScript files under `src/`
(13,216 lines) including all 37 API routes, the Drizzle schema and three migrations, every component
and every `src/lib` module; `e2e/` (7 specs, 48 tests) and `src/lib/__tests__/` (4 files, 85 tests);
all 7 GitHub Actions workflows; both Dockerfiles and all three compose files; `examples/agent.mjs`
and `examples/skill/ushabti/`; `scripts/migrate.mjs`; git history, tags and GitHub repository
metadata.

**Verified personally rather than accepted from a discovery pass:** the register/add-member deadlock
and both error strings; the missing `ConfirmRow` on option delete against the present one on property
delete; `humanOnly()` scoped to the `filters` branch of the view PATCH; `board.mjs step` omitting
`status` and `board.mjs task` omitting `control`, against `obeys()` on the server; the absence of
search, sorting and archive; `.gitignore` and `.git/info/exclude` coverage of `.env` and `infra/`.

**Corrected during the audit.** One discovery pass reported `.env` as tracked by git and
`SESSION_SECRET` as a live misconfiguration; `.env` is untracked and gitignored, and the variable
appears only in the local file, not in `.env.example` — it is a harmless leftover, downgraded to a
note in O4. Two passes reported agents creating structure as a permission bug; the code and the docs
site agree it is intended, and only `AGENTS.md`'s summary sentence is loose — reclassified as a
decision (§7 Q2) rather than a defect.

**Skipped.** No code was executed, no server started and no browser driven, so every runtime claim
comes from reading rather than observation — in particular the Pause/Resume break (#2) is traced
through the code and not reproduced live, though the paths are short and unambiguous. Test *counts*
were reported by a discovery pass that ran the unit suite; I did not re-run either suite. `website/`
was read for content, not audited as a codebase. `infra/` was inspected only for what it exposes.
`node_modules`, `.next` and `website/dist` were excluded throughout. No performance measurement, no
load testing, no accessibility tooling and no dependency-vulnerability scan was run.

**Confidence.** High on the feature inventory, the permission matrix, the documentation
contradictions and the three headline breaks — all read directly and cross-checked. Medium on effort
estimates, which assume familiarity with the codebase and no hidden coupling. Medium on the
prioritization itself, which rests on assumption 1 (that outside adoption is the goal); if this is
principally a personal tool that happens to be public, items 1, 5, 6 and 9 lose most of their
urgency and items 4, 7 and 10 become the whole list.

**Not assessed.** Whether the product is *wanted* — no user research, no competitive pricing
analysis and no demand evidence exists or was available. That is the largest open question about
this product and it is not one a code audit can answer.
