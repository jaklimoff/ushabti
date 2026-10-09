import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { planImport, previewOf } from "@/lib/import/plan";
import { readTrello } from "@/lib/import/trello";
import { ME, newProject, renderWithBoard } from "@/test/board";
import trello from "../../../e2e/fixtures/trello-small.json";
import { ImportPanel } from "./ImportPanel";
import { SettingsShell } from "./SettingsShell";

/*
 * The import page on a phone. This was a test of `e2e/import.spec.ts`, and
 * its name is the name it had there. The preview is the planner's own answer
 * for the same file the spec picks; what an import writes is
 * `import-route.test.ts`, and one file through the page stayed end to end.
 */

afterEach(async () => {
  await page.viewport(1440, 900);
});

test("the import page reads on a phone", async () => {
  await page.viewport(390, 780);
  const data = newProject();
  /* The planner runs on the server and counts bytes as Node does. Vitest
     reads Buffer itself, so the stand-in goes as soon as the file is read. */
  vi.stubGlobal("Buffer", { byteLength: (s: string) => new TextEncoder().encode(s).length });
  const read = readTrello(JSON.stringify(trello));
  vi.unstubAllGlobals();
  if (!read.ok) throw new Error(read.said);
  const preview = previewOf(
    planImport(read.board, {
      properties: data.properties.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        options: p.options.map((o) => ({ id: o.id, name: o.name })),
      })),
      members: data.members.map((m) => ({ id: m.id, name: m.name })),
      groupPropertyId: data.views[0].groupById,
      already: new Set(),
    }),
  );

  await renderWithBoard(
    <SettingsShell initial={data} user={ME} version="test">
      <ImportPanel />
    </SettingsShell>,
    data,
    ({ method, path }) => {
      if (method === "POST" && path.endsWith("/import/preview")) return { body: { preview } };
    },
  );

  const box = page.getByLabelText("The Trello export to bring in");
  await expect.element(box).toBeEnabled();
  await userEvent.upload(
    box,
    new File([JSON.stringify(trello)], "trello.json", { type: "application/json" }),
  );
  await expect.element(page.getByText("Launch board")).toBeVisible();
  await expect.element(page.getByText("4 coming")).toBeVisible();

  const doc = document.documentElement;
  expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);
});
