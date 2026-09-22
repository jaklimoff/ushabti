/**
 * A field saves on blur. A tab closed while the field still has the focus
 * sends no blur, so the edit is lost. This is the rule for that missing blur:
 * what a leaving page still owes the server, and whether it has already been
 * sent.
 */

/** The request a blur would have sent. */
export type LeaveSend = {
  method: "PATCH" | "PUT";
  url: string;
  body: unknown;
};

/**
 * The trimmed words a box still owes, or null when it holds nothing new.
 * The blur and the leave ask this one question, so they can never disagree
 * about whether there is an edit to save.
 */
export function editedText(draft: string, saved: string): string | null {
  const trimmed = draft.trim();
  return trimmed && trimmed !== saved ? trimmed : null;
}

/** What a leave sent, so the next one can tell it apart from a new edit. */
export function markOf(send: LeaveSend): string {
  return `${send.method} ${send.url} ${JSON.stringify(send.body)}`;
}

/**
 * `pagehide` can fire more than once for one page: a page kept for the back
 * button is hidden, shown again and hidden again. The same edit must not go
 * out twice. The mark is the request itself, so a second leave with nothing
 * new sends nothing, while a leave after another keystroke sends the new
 * words.
 */
export function sendOnLeave(
  unsaved: LeaveSend | null,
  sent: string | null,
): { send: LeaveSend; mark: string } | null {
  if (!unsaved) return null;
  const mark = markOf(unsaved);
  if (mark === sent) return null;
  return { send: unsaved, mark };
}
