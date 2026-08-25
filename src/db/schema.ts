import { sql } from "drizzle-orm";
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
  },
  (t) => [
    uniqueIndex("tasks_project_number_key").on(t.projectId, t.number),
    index("tasks_project_position_idx").on(t.projectId, t.position),
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
    /** created | title | description | value | checklist | comment | run | deleted */
    kind: text("kind").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_task_idx").on(t.taskId), index("activity_project_idx").on(t.projectId)],
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
    /** The property that becomes the columns of the board. */
    /** Never cascades: the delete route refuses while any view points here. */
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
    /** running | paused | done | failed | stopped | taken_over | lost */
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
  (t) => [index("agent_run_log_run_idx").on(t.runId)],
);
