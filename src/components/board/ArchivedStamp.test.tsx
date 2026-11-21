import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup } from "vitest-browser-react";
import type { ArchivedTaskDTO, BoardData } from "@/lib/types";
import { newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { useBoard } from "./store";

/*
 * The browser's half of the archived stamp: it keeps the last list the server
 * sent, sends its stamp with every read, and reads an answer without the list
 * as that kept list. The server's half is `archived-stamp-route.test.ts`.
 */

const BOARD = /\/board$/;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* What the store holds, written down on every render. */
const seen: { archived: ArchivedTaskDTO[]; live: string[] }[] = [];
function Probe() {
  const { data, archiveTask } = useBoard();
  seen.push({ archived: data.archived, live: data.tasks.map((t) => t.id) });
  return (
    <button type="button" onClick={() => void archiveTask(data.tasks[0].id)}>
      archive
    </button>
  );
}
const last = () => seen[seen.length - 1];

function shelved(data: BoardData, title: string): ArchivedTaskDTO {
  const number = data.tasks.length + data.archived.length + 1;
  const row: ArchivedTaskDTO = {
    id: `00000000-0000-4000-9000-${String(number).padStart(12, "0")}`,
    number,
    key: `${data.project.key}-${number}`,
    title,
    position: `z${number}`,
    archivedAt: "2026-09-01T10:00:00.000Z",
    shippedIn: null,
  };
  data.archived.push(row);
  return row;
}

/* The server's answer while the list is the one the stamp names. */
function leftOut(data: BoardData): Answer {
  return ({ method, path, query }) => {
    if (method !== "GET" || !BOARD.test(path)) return undefined;
    if (query.get("archivedStamp") !== data.archivedStamp) return { body: data };
    const { archived: _, ...rest } = data;
    return { body: rest };
  };
}

describe("The archived list the browser keeps", () => {
  test("a read sends the stamp it holds, and a read without the list keeps the same list", async () => {
    seen.length = 0;
    const data = newProject();
    withTask(data, "Live work");
    shelved(data, "Old work");
    data.archivedStamp = "stamp-one";
    const { sent, ring } = await renderWithBoard(<Probe />, data, leftOut(data));
    const before = last().archived;

    ring();
    await expect.poll(() => sent("GET", BOARD).length).toBe(1);
    expect(sent("GET", BOARD)[0].query.get("archivedStamp")).toBe("stamp-one");
    await new Promise((done) => setTimeout(done, 50));
    expect(last().archived.map((t) => t.title)).toEqual(["Old work"]);
    /* The same object, so nothing that reads it draws again. */
    expect(last().archived).toBe(before);
  });

  test("a whole list from the server is kept, with its stamp, for the next read", async () => {
    seen.length = 0;
    const data = newProject();
    shelved(data, "Old work");
    data.archivedStamp = "stamp-one";
    const { sent, ring } = await renderWithBoard(<Probe />, data, leftOut(data));

    shelved(data, "Newer work");
    data.archivedStamp = "stamp-two";
    ring();
    await expect.poll(() => last().archived.length).toBe(2);

    ring();
    await expect.poll(() => sent("GET", BOARD).length).toBe(2);
    expect(sent("GET", BOARD)[1].query.get("archivedStamp")).toBe("stamp-two");
    await new Promise((done) => setTimeout(done, 50));
    expect(last().archived.map((t) => t.title)).toEqual(["Old work", "Newer work"]);
  });

  test("a refused archive is rolled back by the next read, which leaves the list out", async () => {
    seen.length = 0;
    const data = newProject();
    const live = withTask(data, "Live work");
    shelved(data, "Old work");
    data.archivedStamp = "stamp-one";
    const board = leftOut(data);
    const { sent, screen } = await renderWithBoard(<Probe />, data, (asked) =>
      asked.method === "POST" && asked.path === `/api/tasks/${live.id}/archive`
        ? { status: 500, body: { error: "The change did not save." } }
        : board(asked),
    );

    await screen.getByRole("button", { name: "archive" }).click();
    await expect.poll(() => sent("GET", BOARD).length).toBe(1);
    expect(sent("GET", BOARD)[0].query.get("archivedStamp")).toBe("stamp-one");
    /* The store moved the card to the archive before the server answered. */
    expect(seen.some((s) => s.archived.length === 2 && s.live.length === 0)).toBe(true);
    await expect.poll(() => last().live).toEqual([live.id]);
    expect(last().archived.map((t) => t.title)).toEqual(["Old work"]);
  });
});
