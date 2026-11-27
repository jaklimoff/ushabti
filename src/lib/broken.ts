/*
 * What a page that broke says, read by both boundaries that draw it. A value
 * thrown in a client component is passed on as it is, and need not be an
 * Error, so the digest is read only when it is there and is a string.
 */

export const BROKE_TITLE = "Something broke";
export const BROKE_BODY =
  "The page could not finish loading. Try again; if it keeps happening, look at the server log.";

export function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  const { digest } = error;
  return typeof digest === "string" && digest ? digest : undefined;
}
