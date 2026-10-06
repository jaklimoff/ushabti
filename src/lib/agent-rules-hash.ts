import "server-only";
import { createHash } from "node:crypto";

/**
 * A short name for one version of the rules. The claim answer carries it and
 * so does the activity line a change writes, so a person can match the rules
 * a run was given to the change that wrote them.
 */
export function rulesHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
