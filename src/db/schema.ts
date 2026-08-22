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
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
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
    /** created | title | description | value | checklist | comment | deleted */
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
    /** { hidden: string[] } - option ids whose column stays collapsed. */
    config: jsonb("config").notNull().default({}),
  },
  (t) => [index("views_project_idx").on(t.projectId)],
);
