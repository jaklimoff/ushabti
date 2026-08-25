# Working on Ushabti

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. It has the set-up, the checks
that must pass, the style, and how a release is made. [ROADMAP.md](ROADMAP.md)
says what the project will not do. This page holds only what those two do not,
and what is easy to get wrong.

- **No task field is hardcoded.** Not Status, not Priority, not a due date.
  Every field on a task is a property somebody defined. A change that adds a
  fixed field works against the whole idea, however small it looks. Add a
  property type instead.
- **`scripts/migrate.mjs` runs outside the traced server.** The image ships
  Next's standalone output, which carries only the files the build saw the
  server touch. Nothing imports the migration script, so its packages are named
  by hand in `outputFileTracingIncludes` in `next.config.mjs`. Add an import to
  that script without adding it there and the image builds, starts, and dies on
  the first line.
- **The end to end tests serve the production build when `CI` is set.** They
  used to serve `next dev`, which hid a real fault for months. If a test passes
  locally and fails on CI, run it with `CI=1` before you suspect CI.
- **An agent is a row in `users`.** It is a member of the project with
  `kind = "agent"` and no password. Nothing else in the schema knows about
  agents, which is why an assignee, a comment author and an activity actor all
  work for them without a second code path. Resist a parallel identity table.
- **Every JSON route accepts a token.** `guard()` takes a session cookie or an
  `Authorization: Bearer` header, and the token carries the one project it
  opens. When you add a route, decide on purpose whether an agent may call it:
  `humanOnly()` for anything that hands out access, `agentOnly()` for the run
  routes. A route that forgets is agent-callable.
- **The card stays quiet.** One strip at the bottom: who, what, how long. The
  plan, the log and the buttons belong to the Agent tab of the panel, which
  exists only while a run does. A board with ten runs on it has to stay
  readable, which is why the step count and the log ticker never reached the
  card.
- **The board has one tab stop.** The cursor is a card, and that card is the
  only card `Tab` can reach; `BoardCanvas` holds which one and `TaskCard` sets
  `tabIndex` after dnd-kit's own attributes, which hand every card a stop. Give
  the cards their stops back and `Tab` walks all forty before it leaves the
  board. The cursor is also the focused element, so the arrow keys move focus
  and the drag sensor keeps working — which is why `BoardCanvas` ignores the
  arrows while a card is lifted. Those arrows belong to the drag.
- **Nothing on this board may be picked by the distance between corners.** A
  column is as tall as the board, so an empty one has two corners hundreds of
  pixels away and loses every sum to a small card one column further over. That
  is why `collision` reaches for the pointer first and rectangle overlap second,
  and why the arrow keys of a lifted card work the columns out themselves in
  `liftedCardCoordinates` instead of asking `sortableKeyboardCoordinates`. Both
  halves have to hold: the drop target is one decision, where the key puts the
  card is another, and a release that fixed only the first one read as fixed.
- **A filter is read afresh, never cleaned up.** Nothing rewrites a view when
  the property or the option one of its rules names is deleted, so a saved rule
  can point at nothing. `readFilters()` throws those away every time the board
  is read — on the server in `toViewDTO`, and again on the write in the view
  route. Do not add a cleanup pass to the delete transactions instead: it would
  have to run in four places and would still lose a race. A rule nobody can see
  must never keep hiding cards, which is why the chips and the hiding are drawn
  from the same reading.
- **Every rule has to pass, and "is not" keeps the empties.** A filter narrows;
  there is no "any of these rules". A task with no priority is not High, so
  `Priority is not High` shows it. Jira's `!=` drops those, which is how people
  ship a board they believe is complete. "Nothing yet" is a _value_ in a rule's
  set — `NO_VALUE_KEY` — and not an operator, so "Doing, or nothing yet" is one
  rule rather than two that can never both pass.
- **A filter that names the grouping property takes its columns with it.** An
  empty column you may still drop a card into is a trap: the card would vanish
  where it landed. `allowedColumns()` removes them, and nothing is lost, because
  a task in one of them failed the same rule. For the same reason a column
  cannot be _dragged_ through such a filter — a drop can only name the column it
  landed after, and the option order belongs to the property that everybody
  shares. And a new column made under one joins the rule, because nobody makes
  a column in order not to see it.
- **Picking a property asks a question; it never answers it.** A new rule
  carries no value, so nothing is written to the view, nothing is broadcast and
  no chip is drawn until somebody says what they meant. `hasAnswer()` is the one
  place that decides, and both the panel and `readFilters()` ask it, so a rule
  that reaches a board always means something. The operator may have a default —
  that is the shape of the question, not the answer.
- **Adding a task under a filter fills in what the filter asks for.** Otherwise
  the card is written and hidden in the same breath with nothing on screen to
  say why. `seedValues()` answers only a rule it can answer without guessing —
  one value, positive, and not the grouping property, which the column decides.
  The composer says what it will write before it writes it.
- **Pause and Stop are requests, not commands.** The server cannot reach into
  another machine. It writes a word on the run; the agent reads it in the answer
  to its next report and obeys because it said it would. Only **Take over**
  decides anything, because it acts on our own database.
- **A beat is not a report.** `updated_at` is the last thing an agent said.
  `beat_at` is the last sign that its process is alive. The lease that closes a
  silent run counts reports and never beats. Let a beat write `updated_at` and
  a heartbeat left behind by a killed session holds a card open all day, which
  is the exact fault the lease exists to fix.
- **Structure is the owner's; content is shared.** A member — and an agent —
  writes values, comments and runs all day. Only a person, and only the owner,
  deletes a property, an option or a view, and only a person writes a run's
  control word. `ownerOnly()` and `humanOnly()` say so at the top of those
  routes. An agent that loses its token would otherwise take the board apart.
- **A field saves on blur. A destructive action confirms in place. Nothing
  else has a Save button.** Settings used to hold six different save models on
  one page, and the one field a new person edits first was the odd one out.
  `ConfirmRow` is the answer to "the board has no dialogs": the row becomes the
  question, and the question names the cost in real numbers.
- **Off the board, geometry comes from `components/ui/`.** A button, an input,
  a tag and a card are declared once. They used to be declared three times
  each, at three different heights. The board keeps its own CSS on purpose.
- **Write short plain sentences**, in the interface, in comments and in commit
  messages. Comments say why, never what.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
