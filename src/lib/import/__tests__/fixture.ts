import { readFileSync } from "node:fs";
import { readTrello, type SourceBoard } from "../trello";

/**
 * The small export both test files read.
 *
 * It is the file the Playwright test picks as well, so the mapping a unit
 * test proves and the mapping a browser walks through are the same board.
 */
export const FIXTURE = "e2e/fixtures/trello-small.json";

export function fixture(): SourceBoard {
  const read = readTrello(readFileSync(FIXTURE, "utf8"));
  if (!read.ok) throw new Error(read.said);
  return read.board;
}
