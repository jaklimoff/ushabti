export const PROPERTY_TYPES = [
  "select",
  "multi_select",
  "person",
  "text",
  "number",
  "date",
  "checkbox",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  select: "Select",
  multi_select: "Multi-select",
  person: "Person",
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
};

export const PROPERTY_TYPE_HINT: Record<PropertyType, string> = {
  select: "One option from a list you define. Can group the board.",
  multi_select: "Any number of options from a list you define.",
  person: "One member of the project. Can group the board.",
  text: "Free text.",
  number: "A number.",
  date: "A calendar date.",
  checkbox: "On or off.",
};

/** Only these types can become the columns of a board. */
export const GROUPABLE_TYPES: PropertyType[] = ["select", "person", "checkbox"];

export type PropertyConfig = {
  showOnCard?: boolean;
};

export type PropertyOptionDTO = {
  id: string;
  name: string;
  color: string;
  position: string;
};

export type PropertyDTO = {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  config: PropertyConfig;
  options: PropertyOptionDTO[];
};

export type MemberDTO = {
  id: string;
  name: string;
  email: string;
  color: string;
  role: string;
};

export type TaskValue = string | string[] | number | boolean | null;

export type TaskDTO = {
  id: string;
  number: number;
  key: string;
  title: string;
  description: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, TaskValue>;
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
};

export type ViewDTO = {
  id: string;
  name: string;
  groupById: string | null;
  position: string;
  isDefault: boolean;
};

export type ChecklistItemDTO = {
  id: string;
  text: string;
  done: boolean;
  position: string;
};

export type CommentDTO = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; color: string } | null;
};

export type ActivityDTO = {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string; color: string } | null;
};

export type TaskDetailDTO = TaskDTO & {
  checklist: ChecklistItemDTO[];
  comments: CommentDTO[];
  activity: ActivityDTO[];
};

export type ProjectDTO = {
  id: string;
  name: string;
  key: string;
  ownerId: string;
  role: string;
};

export type BoardData = {
  project: ProjectDTO;
  members: MemberDTO[];
  properties: PropertyDTO[];
  views: ViewDTO[];
  tasks: TaskDTO[];
};
