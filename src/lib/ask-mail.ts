import { cardOrder } from "./card-view";
import type { Mail } from "./mail";

/**
 * A question an agent asked, by email, once.
 *
 * An ask is a run with status `waiting`. A board that nobody has open shows
 * it to nobody, so after a quiet delay the server sends one email about it to
 * one person. There is no reminder and no digest: a second email about the
 * same question teaches people to ignore the first.
 *
 * Nothing here reads the database or the clock, so a unit test drives it all.
 * `ask-sender.ts` asks the same questions of the rows.
 */

/** How long an ask waits for an answer before it is emailed. */
export const ASK_MAIL_AFTER_MS = 15 * 60_000;

export type AskState = {
  status: string;
  /** When the run began to wait. Null for a run that never asked. */
  askedAt: Date | null;
  /** When the ask was taken for its email. Null until then. */
  askMailedAt: Date | null;
  /** The newest comment a person wrote on the task, or null. */
  answeredAt: Date | null;
};

/**
 * Whether this ask is owed its email now. An answer is a run that is no
 * longer waiting, or a comment a person wrote after the question: the agent
 * may not have woken to read it yet, and the person has already answered.
 */
export function isDue(ask: AskState, now: Date): boolean {
  if (ask.status !== "waiting" || !ask.askedAt || ask.askMailedAt) return false;
  if (ask.answeredAt && ask.answeredAt >= ask.askedAt) return false;
  return now.getTime() - ask.askedAt.getTime() >= ASK_MAIL_AFTER_MS;
}

export type AskMember = {
  id: string;
  kind: string;
  role: string;
  email: string | null;
  askMail: boolean;
};

/**
 * Who the email goes to. The owner chose the order: the person the task is
 * assigned to, else the last person who touched it, else the owners and
 * admins. "Assigned" is no hardcoded field: it is the first person property,
 * in the Settings order, that holds one person and not an agent.
 *
 * Only a member of the project is asked, so a question never reaches somebody
 * who has left. A person who turned these emails off is still the one it was
 * for, so the email goes to nobody rather than to somebody else.
 */
export function addresseesOf(input: {
  /** The project's properties, in their Settings order. */
  properties: readonly { id: string; type: string }[];
  /** The task's values, by property id. */
  values: Record<string, unknown>;
  members: readonly AskMember[];
  /** The people who changed the task or commented on it, newest first. */
  touchers: readonly string[];
}): AskMember[] {
  const person = (id: unknown) =>
    typeof id === "string"
      ? input.members.find((m) => m.id === id && m.kind === "human")
      : undefined;
  const reachable = (people: AskMember[]) => people.filter((m) => m.askMail && m.email);

  const byId = new Map(input.properties.map((p) => [p.id, p]));
  for (const id of cardOrder(input.properties)) {
    if (byId.get(id)?.type !== "person") continue;
    const assignee = person(input.values[id]);
    if (assignee) return reachable([assignee]);
  }

  for (const id of input.touchers) {
    const toucher = person(id);
    if (toucher) return reachable([toucher]);
  }

  return reachable(
    input.members.filter((m) => m.kind === "human" && (m.role === "owner" || m.role === "admin")),
  );
}

/**
 * The question in full. A run's step holds at most 200 characters, so a long
 * question was cut there; the agent's own comment holds all of it when it
 * asked the usual way, and that comment begins with the same words.
 */
export function questionOf(step: string, agentComments: readonly string[]): string {
  const head = step.replace(/…$/, "").trim();
  if (!head) return step;
  const whole = agentComments.find((body) => body.replace(/\s+/g, " ").trim().startsWith(head));
  return whole?.trim() ?? step;
}

/** The link that opens the task, on the address the board is reached at. */
export function askLink(origin: string, projectId: string, key: string): string {
  return `${origin}/p/${encodeURIComponent(projectId)}?task=${encodeURIComponent(key)}`;
}

/** The one email about one ask. */
export function askMail(input: {
  to: string;
  project: string;
  key: string;
  title: string;
  agent: string;
  question: string;
  link: string;
}): Mail {
  return {
    to: input.to,
    subject: `${input.agent} asked a question on ${input.key} in ${input.project}`,
    text: [
      `${input.agent} asked a question on ${input.key} ${input.title}, in the project ${input.project} on Ushabti, and nobody has answered it for ${ASK_MAIL_AFTER_MS / 60_000} minutes.`,
      "",
      input.question,
      "",
      "Answer it with a comment on the task:",
      "",
      input.link,
      "",
      "This is the only email about this question. You can turn these emails off on your account page.",
    ].join("\n"),
  };
}
