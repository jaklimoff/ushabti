import "server-only";
import { HttpError } from "@/lib/auth";
import type { MappingAsk } from "./plan";
import { MAX_FILE_BYTES, readTrello, TOO_LARGE, type SourceBoard } from "./trello";

/**
 * How a file and an answer arrive at the two import routes.
 *
 * Both take the same body, because the page posts the same file twice: once
 * to see what would happen and once to make it happen. Nothing is kept
 * between them — the browser holds the file, and a half-finished import on
 * the server would be a thing somebody has to clean up.
 *
 * It is here and not in a route because a route file may export nothing but
 * its methods, and because two routes reading a body two ways is how one of
 * them ends up with a limit the other has not got.
 */

/** Room for the multipart envelope around a file of the full size. */
const ENVELOPE_BYTES = 64 * 1024;

export type ImportRequest = { board: SourceBoard; ask: MappingAsk };

export async function readImportRequest(req: Request): Promise<ImportRequest> {
  /* Before the body is read, not after. `formData()` holds the whole request
     in memory, so a file nobody may send has to be refused by its header. */
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_FILE_BYTES + ENVELOPE_BYTES) {
    throw new HttpError(413, TOO_LARGE);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Send the export as a file.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Pick a Trello export first.");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, TOO_LARGE);

  const read = readTrello(await file.text());
  if (!read.ok) throw new HttpError(400, read.said);

  return { board: read.board, ask: readMapping(form.get("mapping")) };
}

/**
 * What the owner changed on the preview, as far as it can be read.
 *
 * A name the plan does not know is simply not an answer: `planImport` falls
 * back to its own proposal for anything it cannot place, so a stale id from a
 * preview drawn before somebody renamed an option cannot stop an import
 * halfway through.
 */
function readMapping(raw: FormDataEntryValue | null): MappingAsk {
  if (typeof raw !== "string" || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "That mapping is not JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const ask = parsed as Record<string, unknown>;
  return {
    groupPropertyId: typeof ask.groupPropertyId === "string" ? ask.groupPropertyId : null,
    lists: targets(ask.lists),
    labels: targets(ask.labels),
    archived: ask.archived === true,
  };
}

/** Source id → an option id, or null for "make a new one". Nothing else. */
function targets(raw: unknown): Record<string, string | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null) out[key] = null;
    else if (typeof value === "string") out[key] = value;
  }
  return out;
}
