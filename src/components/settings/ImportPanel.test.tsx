import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { planImport, previewOf } from "@/lib/import/plan";
import { readTrello } from "@/lib/import/trello";
import type { ImportPreviewDTO } from "@/lib/types";
import { ME, newProject, renderWithBoard } from "@/test/board";
import trello from "@/test/fixtures/trello-small.json";
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

/** The planner's own preview of the fixture, for a project of this shape. */
function previewFor(data: ReturnType<typeof newProject>) {
  const read = readTrello(JSON.stringify(trello));
  if (!read.ok) throw new Error(read.said);
  return previewOf(
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
}

async function pickFile(data: ReturnType<typeof newProject>, preview: ImportPreviewDTO) {
  await renderWithBoard(
    <SettingsShell initial={data} user={ME} version="test">
      <ImportPanel />
    </SettingsShell>,
    data,
    ({ method, path }) => {
      if (method === "POST" && path.endsWith("/import/preview")) return { body: { preview } };
    },
  );

  const box = page.getByLabelText("The export to bring in");
  await expect.element(box).toBeEnabled();
  await userEvent.upload(
    box,
    new File([JSON.stringify(trello)], "trello.json", { type: "application/json" }),
  );
}

test("the import page reads on a phone", async () => {
  await page.viewport(390, 780);
  const data = newProject();
  await pickFile(data, previewFor(data));
  await expect.element(page.getByText("Launch board")).toBeVisible();
  await expect.element(page.getByText("4 coming")).toBeVisible();

  const doc = document.documentElement;
  expect(Math.max(doc.scrollWidth - doc.clientWidth, 0)).toBe(0);
});

/* What the plan counts is `plan.test.ts`; this is that the page says it. */
test("the preview counts the cards that come with no column", async () => {
  const data = newProject();
  const preview = previewFor(data);
  expect(preview.columnless).toBe(0);
  await pickFile(data, { ...preview, columnless: 2 });
  await expect.element(page.getByText("4 coming")).toBeVisible();
  await expect.element(page.getByText(`2 with no ${preview.group.name}`)).toBeVisible();
});

/* The screen half of "an admin downloads the project". What the file holds
   and who the route lets in is `export-route.test.ts`. */
test("an admin is offered the download before the import, and a member sees no row", async () => {
  const data = newProject();
  data.project = { ...data.project, role: "admin" };
  const admin = await renderWithBoard(<ImportPanel />, data);
  const download = page.getByRole("link", { name: "Download" });
  await expect.element(download).toHaveAttribute("href", `/api/projects/${data.project.id}/export`);
  await expect.element(download).toHaveAttribute("download");
  expect(
    page
      .getByRole("heading", { level: 2 })
      .elements()
      .map((h) => h.textContent),
  ).toEqual(["Export", "Import a board"]);
  await admin.screen.unmount();

  const member = newProject();
  member.project = { ...member.project, role: "member" };
  await renderWithBoard(<ImportPanel />, member);
  await expect
    .element(page.getByRole("heading", { name: "Import and export", level: 1 }))
    .toBeVisible();
  expect(page.getByText("Export", { exact: true }).elements()).toHaveLength(0);
  expect(download.elements()).toHaveLength(0);
});
