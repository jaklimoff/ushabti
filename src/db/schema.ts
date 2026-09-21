import { desc, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for an agent. Only a human signs in. */
    email: text("email"),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    /** human | agent. An agent is a member like any other, with no password. */
    kind: text("kind").notNull().default("human"),
    color: text("color").notNull().default("#6d5bd0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Projects and membership                                             */
/* ------------------------------------------------------------------ */

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Short prefix for task keys, e.g. "USH" gives USH-14. */
  key: text("key").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Monotonic counter that produces the number part of a task key. */
  taskCounter: integer("task_counter").notNull().default(0),
  /**
   * What every card on this board carries: `{ order, rows }`. Null until
   * somebody arranges one, and read through `readCardView`, which throws away a
   * row naming a property that is gone.
   */
  cardView: jsonb("card_view"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "owner" can delete the project and manage members. "member" can do the rest. */
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_idx").on(t.userId),
  ],
);

/**
 * An email the owner added before it had an account. Whoever registers with
 * it joins the project at once, and the row goes. It is also the one way in
 * through a closed sign-up, which is why the register route reads it: without
 * it the owner is told "ask them to register" and the person "ask the owner",
 * and nobody can break the circle.
 */
export const projectInvites = pgTable(
  "project_invites",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.email] }),
    index("project_invites_email_idx").on(t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* Custom properties                                                   */
/* ------------------------------------------------------------------ */

/**
 * Nothing about a task is hardcoded. Status, Priority, Assignee and every other
 * field is a row in this table, created when the project is created and fully
 * editable afterwards.
 */
export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** select | multi_select | person | text | number | date | checkbox */
    type: text("type").notNull(),
    position: text("position").notNull(),
    /** { showOnCard: boolean, ... } */
    config: jsonb("config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("properties_project_idx").on(t.projectId)],
);

export const propertyOptions = pgTable(
  "property_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    position: text("position").notNull(),
  },
  (t) => [index("property_options_property_idx").on(t.propertyId)],
);

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Fractional index. One global order per project drives every view. */
    position: text("position").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When somebody archived this task. Null for a live task. It is a mark on
     * the row and not a property: Status is the owner's and may be renamed or
     * deleted, while "off the board but still here" is the product's own idea.
     * An archived task keeps every row that points at it.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tasks_project_number_key").on(t.projectId, t.number),
    index("tasks_project_position_idx").on(t.projectId, t.position),
    // The board reads the live tasks of one project in rank order, and that is
    // the read on every page load. A partial index keeps the archived rows out
    // of it for good, however many of them pile up.
    index("tasks_project_live_idx")
      .on(t.projectId, t.position)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * One row per (task, property). `value` holds the shape that matches the
 * property type: option id for select, array of option ids for multi_select,
 * user id for person, string / number / boolean for the scalar types.
 */
export const taskValues = pgTable(
  "task_values",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    value: jsonb("value"),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.propertyId] }),
    index("task_values_property_idx").on(t.propertyId),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    position: text("position").notNull(),
  },
  (t) => [index("checklist_task_idx").on(t.taskId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_task_idx").on(t.taskId)],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** created | title | description | value | checklist | comment | run | archive | reset | deleted */
    kind: text("kind").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_task_idx").on(t.taskId),
    index("activity_project_idx").on(t.projectId),
    // The feed an agent reads to catch up walks a project in time order.
    index("activity_project_time_idx").on(t.projectId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export const views = pgTable(
  "views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * board | list. What shape the same tasks are drawn in: columns, or one
     * dense list. Nothing else about a view changes with it, which is why it
     * is one word and not a second table.
     */
    kind: text("kind").notNull().default("board"),
    /** The property that becomes the columns of the board. */
    /** Never cascades: the delete route refuses while any view points here. */
    /** A list may hold none: it groups nothing, so it needs nothing. */
    groupById: uuid("group_by_id").references(() => properties.id, { onDelete: "set null" }),
    position: text("position").notNull(),
    /** The first view of a project cannot be deleted. */
    isDefault: boolean("is_default").notNull().default(false),
    /**
     * What this view does to the board beyond grouping it.
     * `{ filters: { rules: FilterRule[] } }` - which tasks it shows.
     */
    config: jsonb("config").notNull().default({}),
  },
  (t) => [index("views_project_idx").on(t.projectId)],
);

/**
 * The rules one person added to one view, which only that person sees.
 *
 * A filter on the view is the team's answer to "what is this board about". A
 * filter a person adds is their own question, and broadcasting it re-filtered
 * the board for everybody who was looking. So a person's rules live here,
 * beside the view rather than on it, and the board shows the view's plus
 * theirs. They never widen: every rule of both sets has to pass.
 *
 * Only a person has one. An agent reads the view's filters and nothing else.
 */
export const viewLenses = pgTable(
  "view_lenses",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewId: uuid("view_id")
      .notNull()
      .references(() => views.id, { onDelete: "cascade" }),
    /** `{ rules: FilterRule[] }`, read through `readFilters` exactly as a view's is. */
    filters: jsonb("filters").notNull().default({ rules: [] }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.viewId] }),
    index("view_lenses_view_idx").on(t.viewId),
  ],
);

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

/**
 * A token is how a machine member signs in. The plain text is shown once and
 * never stored: only its SHA-256 digest is kept, next to a short prefix so a
 * person can tell two tokens apart in the list.
 */
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** A token opens one project and no other. */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    prefix: text("prefix").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /**
     * The last moment this token held the project stream open. It is written
     * while the stream lives and cleared when it closes. The board reads it
     * against a short lease, so a process that died without closing anything
     * stops reading as listening on its own.
     */
    listeningAt: timestamp("listening_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_tokens_hash_key").on(t.hash),
    index("agent_tokens_agent_idx").on(t.agentId),
    index("agent_tokens_project_idx").on(t.projectId),
  ],
);

/**
 * One piece of work an agent does on one task. The board reads the open run of
 * a task to draw the live signal, and the panel reads its steps and its log.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the whole run is for, in one line. */
    goal: text("goal").notNull().default(""),
    /** What the agent is doing right now, in one line. */
    step: text("step").notNull().default(""),
    /**
     * running | paused | waiting | handed_over | done | failed | stopped |
     * taken_over | lost. `waiting` and `handed_over` are open runs that
     * stopped on purpose, and the lease leaves both alone.
     */
    status: text("status").notNull().default("running"),
    /**
     * What a person asked for: pause, resume or stop. The agent reads it in the
     * answer to its next write and obeys. Nothing here forces it.
     */
    control: text("control"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** The last report. It moves only when the agent says the work moved. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The last sign of life, which is not the last report. A beat says the
     * process is alive and nothing else. The two are kept apart on purpose: a
     * timer must never be able to paint progress that nobody made.
     */
    beatAt: timestamp("beat_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the next report is due, when the last one said how long it would
     * be. Null is the ordinary lease, which is what almost every run holds.
     * Only a report writes this column, and the next report clears it again,
     * so a long step is stretched once and never for ever.
     */
    reportDueAt: timestamp("report_due_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_runs_task_idx").on(t.taskId),
    index("agent_runs_project_idx").on(t.projectId),
    // One task holds one open run. A second start has to wait or take over.
    uniqueIndex("agent_runs_open_task_key")
      .on(t.taskId)
      .where(sql`${t.endedAt} is null`),
  ],
);

export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** todo | active | done */
    state: text("state").notNull().default("todo"),
    index: integer("index").notNull(),
  },
  (t) => [index("agent_run_steps_run_idx").on(t.runId)],
);

export const agentRunLog = pgTable(
  "agent_run_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_run_log_run_idx").on(t.runId),
    // The tail of one run's log, and the newest line of twenty runs at once,
    // both read this table by run and newest first. Without the second column
    // the newest line of a busy run is a sort of everything that run ever said.
    index("agent_run_log_run_time_idx").on(t.runId, desc(t.createdAt)),
  ],
);

/* ------------------------------------------------------------------ */
/* A way back into an account                                          */
/* ------------------------------------------------------------------ */

/**
 * One link that sets one password. There is no email in Ushabti, so the person
 * who vouches for you is the owner of a project you are in: they make the link
 * and send it by whatever channel the team already has.
 *
 * The plain token is shown once and never stored, exactly as an agent token
 * is: only its SHA-256 digest is kept. A row is read afresh and never cleaned
 * up, so a link that is spent, old or superseded stays here until it expires
 * and the reader is the one that calls it dead.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    /** The owner who made it. Null once that account is gone. */
    madeBy: uuid("made_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** When somebody set a password with it. A link works once. */
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("password_resets_hash_key").on(t.hash),
    index("password_resets_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/**
 * A call out of the board, for a service that cannot hold a socket open.
 *
 * It rings the same doorbell the stream rings: that something changed and
 * where, never what. The receiver then reads the feed, exactly as an agent
 * on the stream does.
 *
 * The secret is stored whole, unlike an agent token, because the server signs
 * every body with it. It is still shown once: the page keeps a prefix so a
 * person can tell two apart, and the only way to see another is to roll it.
 */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** The HMAC key. Whole, because the signature is made from it. */
    secret: text("secret").notNull(),
    /** Enough of the secret to tell two of them apart in the list. */
    prefix: text("prefix").notNull(),
    /**
     * The feed words that ring it, as a list of strings. An empty list means
     * every kind, and it is read afresh like a filter: a word nobody knows is
     * thrown away on the way out rather than cleaned up in the table.
     */
    kinds: jsonb("kinds").notNull().default([]),
    /** Off keeps the row and rings nothing. */
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_project_idx").on(t.projectId)],
);

/**
 * One attempt to ring one webhook, and the record of how it went.
 *
 * The body is kept as it was built, so a retry sends the same bytes the first
 * try did and a receiver that skips a delivery it has seen can do so by its
 * id. `nextTryAt` is when the sender should pick it up; null means there is
 * nothing more to do, either because it was taken or because the tries ran out.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    /** The doorbell, as it will be sent and signed. */
    body: jsonb("body").notNull(),
    tries: integer("tries").notNull().default(0),
    /** When the sender should try. Null when it is over, either way. */
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    /** The HTTP code of the last try, or null if nothing answered. */
    code: integer("code"),
    /** Why the last try failed, in one line. Null while it has not. */
    error: text("error"),
    /** When the receiver took it. Null until it does. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The page reads the newest delivery of one webhook, and the sweep reads
    // the oldest. Both walk this index.
    index("webhook_deliveries_hook_time_idx").on(t.webhookId, desc(t.createdAt)),
    // The sender asks one question: what is due now. A partial index keeps
    // every finished delivery out of it for good.
    index("webhook_deliveries_due_idx")
      .on(t.nextTryAt)
      .where(sql`${t.nextTryAt} is not null`),
  ],
);
