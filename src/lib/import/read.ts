import { parseFile, type SourceRead } from "./source";
import { isTrello, readTrelloFile, TRELLO } from "./trello";

/**
 * Which reader a file goes to, by its shape.
 *
 * There is no form field for the kind of export: a file says what it is, and a
 * box that has to agree with the file is one more way to be wrong. A second
 * source is one more row here, with a `knows` that no other row answers.
 */
type Reader = {
  name: string;
  knows: (file: Record<string, unknown>) => boolean;
  read: (file: Record<string, unknown>) => SourceRead;
};

const READERS: Reader[] = [{ name: TRELLO.name, knows: isTrello, read: readTrelloFile }];

/** The kinds the import takes, as one sentence names them: "Trello or GitHub". */
function kinds(): string {
  const names = READERS.map((r) => r.name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
}

/** The sentence a JSON file no reader knows is refused with. */
export function unknownSaid(): string {
  return `That file is not an export the import knows. It takes a board exported from ${kinds()}.`;
}

/** Reads one export of any kind the import takes, or says why it cannot. */
export function readExport(raw: string): SourceRead {
  const parsed = parseFile(raw);
  if (!parsed.ok) return parsed;
  const reader = READERS.find((r) => r.knows(parsed.file));
  if (!reader) return { ok: false, said: unknownSaid() };
  return reader.read(parsed.file);
}
