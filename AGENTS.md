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
- **A card draws the card view and decides nothing.** What a card carries is
  `projects.card_view`, one object of `order` and `rows` that everybody on the
  board shares. `TaskCard` knows how to draw a chip and nothing else — which
  chips there are, where they sit and how they read all come from
  `src/lib/card-view.ts`. Adding a property type means one line in
  `KIND_OF_TYPE`. Putting a decision back in the card, however small, splits
  the answer in two. The detail panel takes the same colour by the same route:
  `cardAccent()` asks the card view for the stripe the card wears, so moving
  the edge moves the panel with it and no screen names a property of its own.
- **A view has a kind, and a list is the same tasks lying down.** `views.kind`
  is `board` or `list`, and nothing else about a view changes with it: one
  filter set, one card view, one card order. A list groups by nothing on
  purpose — sections would need a second drop model, where a drag writes a
  property value, which is what a board already is. It keeps `groupById`
  unread, so turning it back into a board restores the same columns; that is
  also why the property delete route counts only `kind = 'board'`, and why
  `defaultGroupById()` asks only a board. Let a list answer either one and a
  remembered word starts pinning a property nobody is grouping by, or a
  property comes back onto every card in the project.
- **A row draws the card view and decides nothing**, exactly as a card does.
  `listColumns()` in `src/lib/list-view.ts` is the one place that says which
  columns a list has: a row that is off the card is off the list, the edge is
  the stripe and not a column, the description joins the title because a line
  has one line, and the key and the title open the row because a table is read
  from the left. The five places of a card collapse to "a column" — a place
  says where a chip sits on a _card_ — so adding a property type is still one
  line in `KIND_OF_TYPE` plus one width. `buildRow()` sits beside `buildCard()`
  and shares `chipsFor`, so a value cannot read one way on a card and another
  in a list. Its one deliberate difference is that a colour-only chip gets its
  name back: a column's heading names the property, never the value.
- **One view is the main one, and it is named rather than unnamed.** The word
  says two things at once: which view a board opens on when nobody has picked
  one, and which view cannot be deleted. So the route takes `isDefault: true`
  and nothing else — the flag comes off the old view and goes on the new one in
  one transaction, because a project with two main views, or with none, answers
  "which view opens?" twice. It is `adminOnly`, beside deleting a view, and it
  moves what `defaultGroupById` answers: on a project that never arranged a
  card view, the main view is the one that says which property the columns are.
- **A view is dragged by naming what it landed on, never a rank.** The strip
  and the settings page write the same one order, so `landedAfter` in
  `store.tsx` is the only place that works the neighbour out and the route is
  the only place that makes a rank, under the project lock. A property in
  Settings is dragged the same way: `moveProperty` takes what it landed on and
  asks that one helper.
  A pill is a button first: the drag starts after five pixels and dnd-kit
  swallows the click that follows, so picking a view and moving one cannot
  happen at once. The pill's colour follows the view and not its place, because
  a pill that changed colour as it passed its neighbour would read as another
  view. The keyboard route is the grip in settings; the strip keeps Space and
  Enter for picking a view, which is what a top bar is for.
- **A sort writes nothing, which is why a sorted view holds still.** The rank a
  task carries is the one order every view shares; `src/lib/sort.ts` decides
  only what a screen draws, and never writes. So a drag that wrote an order
  nobody on that screen can see would leave the card where the sort puts it,
  which reads as the drag having failed. A list answers by holding every row:
  `useSortable` is disabled and `Space` is swallowed. A board cannot answer that
  way, because a card still has to be able to reach another column — so it holds
  only the inside of a column. `HELD` in `Column.tsx` is a strategy that moves
  nothing, `liftedCardCoordinates` swallows up and down while a card is lifted,
  and a drop into another column writes that column's value through `setValue`
  and no rank at all. One chip is the way back out of both. A board is asked for
  the order from a **Sort** button beside **Filter**, because it has no heading
  to press; its rows are `listColumns()`, the columns a list would draw, named
  as a list names them, so one question has one set of words. The order itself
  is applied once over the whole board before `buildColumns`, which keeps the
  order it is given — there is no second comparator and no pass per column. A
  sort is read afresh like a filter: `readSort()` throws away one that names a
  column that is gone, on the server in `toViewDTO` and again on the write. It
  is not `humanOnly` — a filter is guarded because it hides work from the
  people, and a sort hides nothing.
- **A sort belongs to the person who picked it.** A sorted board holds still,
  so an order written on the view stopped the whole team dragging inside a
  column with nothing on their screens to say why. `setSort` writes the lens,
  beside the rules in the same `filters` jsonb, so there is no second row and
  no migration; `readLensSort()` reads it afresh as `readSort()` does. Mine
  wins over the view's while it exists, and the store's `sort` is that one
  answer, so everything that orders or holds still asks it and a board holds
  still only for the person whose order it is. A lens is put whole, so every
  write of it — the rules, the order, and the filter box's `useSaveOnLeave` —
  carries both halves; a write that sent one would take the other away.
  **Save for everyone** moves the order with the rules in the one transaction
  it already has. `pressSort()` is the one place a press is worked out against
  the view's order: mine never repeats the view's, and a press that would fall
  back to the order already on the screen turns it around instead. The view
  can still carry an order for everybody, and its chip asks before its ✕
  takes it away, as a shared rule does.
- **A sort keys off the card kind, and off the type only where it must.** A
  select orders by its option index, because that order was arranged by hand
  and is the meaning; a multi-select by its lowest index, because its values
  arrive in whatever order somebody clicked them. Empty always sorts last, both
  ways, and equal keys fall back to `position` so a list never shuffles and
  always agrees with the board. Words go through one named `Intl.Collator`, not
  `localeCompare`: the list is drawn on the server and again in the browser, and
  the default locale differs between them — the same hazard the written-out
  month names in `board.ts` exist for.
- **A list is one column of rows, so it walks the board's own cursor.**
  `cursorTarget` over a single synthetic column already answers up, down, Home
  and End, and answers null sideways because its loop finds no second column.
  It must not grow a second walker. For the same reason a list uses dnd-kit's
  own `closestCenter` and `sortableKeyboardCoordinates`: the board overrides
  both to beat a column as tall as the whole board, which loses every sum of
  corner distances. A list has no such container, and unifying the two breaks
  the board.
- **`allowedColumns()` has no equivalent in a list, and must not gain one.** It
  removes a drop target a card could not survive. A list has one drop target
  and every visible task lives in it, so there is nothing to remove.
- **A task added to a list is seeded for the whole filter.** `seedValues()`
  skips the grouping property because the column decides it; a list has no
  column, so it passes `null` and the filter answers for that property too.
  Without it the row is written and hidden in the same breath.
- **The card view is read afresh, never cleaned up**, exactly as a filter is.
  A row can name a property that has been deleted, so `readCardView()` throws
  those away every time — on the server in `loadBoard`, and again on the write.
  It settles the invariants in the same pass: the title never moves, one row at
  most holds the edge, and a mode a row's kind cannot read becomes one it can.
  Do not add a cleanup pass to the delete transaction; it would lose the same
  race the filter one would.
- **Five rows of the card view are not properties.** `_key`, `_title`, `_desc`,
  `_checklist` and `_comments` are the task row the board already has, given
  rows so that somebody can take them off. They are not fields on a task and
  must never become any: nothing writes them, and the words are fixed.
- **A read that started before this tab's own write is thrown away.** The
  stream asks for the board the moment it connects, and that answer is stale
  the instant somebody clicks. `store.tsx` counts the writes and `refresh()`
  drops an answer that was overtaken, which is the only thing standing between
  a fast click after a page load and having it silently undone.
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
- **A search is not a filter, so it must not read one.** `searchTasks()` in
  `src/lib/search.ts` looks at every task in the project and never at
  `visibleTasks`: a filter decides what a view shows and everybody sees it,
  while a search hides nothing, writes nothing and ends by opening one task.
  Narrow it to the view and the one thing a person does with a key somebody
  sent them — paste it in, open the task — stops working on any filtered
  board. What is owed instead is a word on the row: a hit the view is not
  drawing says so. The box sits in the top bar and not in the view strip for
  the same reason; the strip holds what belongs to a view.
- **A filter is read afresh, never cleaned up.** Nothing rewrites a view when
  the property or the option one of its rules names is deleted, so a saved rule
  can point at nothing. `readFilters()` throws those away every time the board
  is read — on the server in `toViewDTO`, and again on the write in the view
  route. Do not add a cleanup pass to the delete transactions instead: it would
  have to run in four places and would still lose a race. A rule nobody can see
  must never keep hiding cards, which is why the chips and the hiding are drawn
  from the same reading.
- **A filter a person adds is theirs, and the two sets join by being put end to
  end.** `view_lenses` holds one person's rules for one view; the view's rules
  are the team's. `mergeFilters()` is the one place they meet — the view's
  first, then theirs — and everything that hides, counts, seeds or drops a
  column reads that one answer, so `visibleTasks`, `allowedColumns`,
  `seedValues` and the pill's count can never disagree with the screen. The
  strip is the only place the two are told apart, because it is the only place
  where it matters which ✕ you pressed. A lens narrows and can never widen: a
  member cannot see past a view's rule, which is what the main view is for.
  `readFilters()` runs on both sets, on the server and on every write. Writing
  a lens broadcasts nothing — it moves one screen, and the stream is for what
  the team shares — while **Save for everyone** is one transaction under the
  project lock and does broadcast. An agent has no lens and never reads one:
  `filters` on the view DTO stays the view's.
- **One property carries one rule, whoever asked.** Two rules about one
  property empty the board with two chips that fight each other, and promoting
  them hands that to the team. `clashOf()` in `src/lib/filters.ts` is the one
  place that decides it, as `hasAnswer()` is for a question: the panel refuses
  the pick with the sentence `clashSaid()` builds, and both routes a rule comes
  in by — the lens `PUT` and the promote `POST` — answer 409 with the same
  sentence. It counts the property and not the operator, because nobody reading
  two chips can tell a pair that narrows from a pair that can never both pass.
  That counts a date, which is the price: two date rules inside one set are
  still two rules on purpose, but a date rule of a lens on a property the view
  already dates is refused with the rest. `mergeFilters` stays a plain joining
  — the guard belongs at the doors a rule comes in by, and a lens can become a
  clash after it is written, which is why every door carries it. `clashOf`
  answers null for a property it cannot name, and that is safe rather than lax:
  every caller reads both sets with `readFilters` first, so a rule about a
  deleted property is gone before the guard sees it.
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
- **The stream is a doorbell; the feed is the record.** An event says that
  something changed and where, never what. A browser answers by reading the
  board, an agent by reading `/activity` after its cursor. SSE drops whatever
  happens while a socket is down, so putting the change itself in an event
  makes a watcher that silently misses work. `ready` goes out after the
  subscription, so a client that reads on `ready` misses nothing in between.
- **Listening is a lease, and only the stream writes it.** `listening_at` on a
  token is touched while an agent holds the stream and cleared when it closes;
  `isListening()` reads it against a minute. It is not "last used": a token
  that made a call is not a token that will hear the next task.
- **A run that waits is the open run the lease leaves alone.** It stopped on
  purpose: `waiting` asked a person something, `handed_over` gave the task to
  somebody else. `WAITING_STATUSES` is the one place that says which, so
  `sweepLost` skips both and `lifeOf` calls both reporting. The two are told
  apart only where the rule differs — an answer wakes the agent that asked,
  while the next agent's `claim` closes a hand-over as done and opens its own,
  which is how one open run per task survives a hand-over. Take over moves
  either.
- **The watcher claims before the harness starts.** The run is the lock: a
  second watcher gets a 409 and leaves the task alone. Do not add a queue or a
  lock beside it. A task an agent created never wakes `--on created`, or two
  agents refine each other's work for ever.
- **Pause and Stop are requests, not commands.** The server cannot reach into
  another machine. It writes a word on the run; the agent reads it in the answer
  to its next report and obeys because it said it would. Only **Take over**
  decides anything, because it acts on our own database.
- **A beat is not a report.** `updated_at` is the last thing an agent said.
  `beat_at` is the last sign that its process is alive. The lease that closes a
  silent run counts reports and never beats. Let a beat write `updated_at` and
  a heartbeat left behind by a killed session holds a card open all day, which
  is the exact fault the lease exists to fix.
- **Structure is an admin's; content is shared.** A member — and an agent —
  writes values, comments and runs all day. Only a person, and only the owner
  or an admin, deletes a property, an option or a view, and only a person
  writes a run's control word. `adminOnly()` and `humanOnly()` say so at the
  top of those routes. An agent that loses its token would otherwise take the
  board apart. Three acts stay the owner's alone — deleting the project,
  handing it over, changing an admin's role — behind `ownerOnly()`. The role
  rule lives once, in `src/lib/roles.ts`, because the settings panels read it
  too; a route never compares a role by hand. An agent is always a member.
- **A field saves on blur. A destructive action confirms in place. Nothing
  else has a Save button.** Settings used to hold six different save models on
  one page, and the one field a new person edits first was the odd one out.
  `ConfirmRow` is the answer to "the board has no dialogs": the row becomes the
  question, and the question names the cost in real numbers. **A closed tab
  sends no blur**, so every such field also says what it owes to
  `useSaveOnLeave`, which sends that one request with `keepalive` on
  `pagehide` — a closed or navigated-away tab; not a tab switched away on a
  phone. It is not an autosave, so a field answers only for what somebody
  typed in this tab: a box that mirrors a saved value holds the old words
  after another tab changes it, and sending those would put the change back.
  A new blur-saved field that forgets either half loses an edit in silence, or
  undoes somebody else's, and only a closed tab shows it. Every box that holds
  words says it: the title, the description and a checklist item of a task, the
  rows of settings
  and of the account, and the filter box, which is the one that puts a whole
  lens where the others patch a row. The value boxes of the detail panel are
  the exception. `PropertyControl` draws the same scalar and date field for one
  task and for a whole selection, so it holds no address of its own, and
  handing it one for the sake of a leave would put a decision back in a control
  that decides nothing.
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
