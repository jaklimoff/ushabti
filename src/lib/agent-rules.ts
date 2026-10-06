/**
 * The rules a project gives the agents that work on its board.
 *
 * The soft limit is shown under the field and refuses nothing: the text goes
 * into every run, so the count says what it costs. The hard limit only keeps
 * one row from holding a book.
 */
export const AGENT_RULES_SOFT = 2000;
export const AGENT_RULES_MAX = 20000;

/** The sentence under the field: how long the text is against the limit. */
export function rulesCount(text: string): string {
  return `${text.length.toLocaleString("en")} / ${AGENT_RULES_SOFT.toLocaleString("en")} characters`;
}
