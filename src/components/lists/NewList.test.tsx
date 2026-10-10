import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { ME, newProject, renderWithBoard, type Answer, type Sent } from "@/test/board";
import { pushed } from "@/test/next-navigation";
import { NewList } from "./NewList";

/*
 * A new list is picked and previewed on one page, and written by one press.
 * What the route writes is `lists-route.test.ts`; this says what the page
 * sends, and when.
 */

const byTestId = (id: string) => page.getByTestId(id);
const tile = (name: string) => byTestId("list-tile").filter({ hasText: name });
const card = (key: string) => byTestId("list-source-edit").filter({ hasText: key });
const create = () => page.getByRole("button", { name: "Create list" });

const data = newProject();
const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const projectsOf = (names: string[]) =>
  names.map((name, i) => ({
    id: id(i + 1),
    key: name.slice(0, 3).toUpperCase(),
    name,
    color: "#7aa8f0",
  }));

/** A project gives three tasks, and nothing once it has a rule. */
const preview: Answer = ({ method, path, body }) => {
  if (method !== "POST" || path !== "/api/lists/preview") return undefined;
  const { projectId, filters } = body as { projectId: string; filters: { rules: unknown[] } };
  return {
    body: {
      source: {
        id: "",
        projectId,
        key: "KEY",
        name: "Name",
        properties: data.properties,
        members: data.members,
        former: data.former,
        rules: [],
      },
      count: filters.rules.length ? 0 : 3,
    },
  };
};

async function draw(names: string[], answer: Answer = preview) {
  const projects = projectsOf(names);
  const drawn = await renderWithBoard(<NewList user={ME} projects={projects} />, data, answer);
  const writes = () =>
    drawn.sent().filter((s: Sent) => s.method !== "GET" && s.path !== "/api/lists/preview");
  return { ...drawn, projects, writes };
}

beforeEach(() => {
  pushed.length = 0;
});

describe("A new list", () => {
  test("writes nothing before Create, and Create opens the list's page", async () => {
    let made = 0;
    const { writes, sent, projects } = await draw(["Harbour", "Lighthouse", "Quay"], (req) =>
      req.method === "POST" && req.path === "/api/lists"
        ? (made++, { status: 201, body: { list: { id: id(99), name: "x" } } })
        : preview(req),
    );
    await expect.element(byTestId("list-home")).toHaveAttribute("href", "/projects");
    await expect.element(byTestId("list-name")).toHaveValue("");
    await expect.element(byTestId("list-name")).toHaveAttribute("placeholder", "My week");
    await expect
      .element(page.getByText("Left empty, it is named after its projects."))
      .toBeVisible();
    await expect
      .element(byTestId("list-needs-project"))
      .toHaveTextContent("Pick a project above. Nothing is written until you press Create.");
    await expect.element(create()).toBeDisabled();

    await tile("Quay").click();
    await tile("Harbour").click();
    await expect.element(tile("Quay")).toHaveAttribute("aria-pressed", "true");
    await expect.element(tile("Lighthouse")).toHaveAttribute("aria-pressed", "false");
    await expect.element(card("HAR").getByTestId("list-source-count")).toHaveTextContent("3 tasks");
    await expect
      .element(page.getByText("Every task of QUA. Add a rule to narrow it."))
      .toBeVisible();
    await expect
      .element(byTestId("list-summary"))
      .toHaveTextContent("2 projects · 0 rules · 6 tasks");
    expect(writes()).toEqual([]);

    await create().click();
    await create().click({ force: true });
    await expect.poll(() => pushed).toEqual([`/lists/${id(99)}`]);
    expect(made).toBe(1);
    const posted = sent().filter((s) => s.path === "/api/lists");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual({
      name: "",
      sources: [
        { projectId: projects[2].id, filters: { rules: [] } },
        { projectId: projects[0].id, filters: { rules: [] } },
      ],
    });
  });

  test("is disabled until a project is picked, and again once it is unpicked", async () => {
    await draw(["Harbour", "Lighthouse"]);
    await expect.element(create()).toBeDisabled();
    await tile("Harbour").click();
    await expect.element(create()).toBeEnabled();
    await card("HAR").getByTestId("list-source-remove").click();
    await expect.element(tile("Harbour")).toHaveAttribute("aria-pressed", "false");
    await expect.element(create()).toBeDisabled();
  });

  test("keeps everything picked when Create fails, and says why", async () => {
    await draw(["Harbour"], (req) =>
      req.method === "POST" && req.path === "/api/lists"
        ? { status: 400, body: { error: "Name is too long." } }
        : preview(req),
    );
    await create().click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Name is too long.");
    await expect.element(tile("Harbour")).toHaveAttribute("aria-pressed", "true");
    await expect.element(create()).toBeEnabled();
    expect(pushed).toEqual([]);
  });

  test("finds a person's only project picked for them", async () => {
    const { sent } = await draw(["Harbour"]);
    await expect.element(tile("Harbour")).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByText("Your only project, picked for you.")).toBeVisible();
    await expect.element(create()).toBeEnabled();
    await expect.element(card("HAR").getByTestId("list-source-count")).toHaveTextContent("3 tasks");
    expect(sent().some((s) => s.path === "/api/lists/preview")).toBe(true);
  });

  test("draws the tiles in the order it is given, which is the person's Home order", async () => {
    await draw(["Quay", "Harbour", "Lighthouse"]);
    const names = Array.from(document.querySelectorAll('[data-testid="list-tile"]')).map(
      (t) => t.textContent,
    );
    expect(names).toEqual(["QUAQuay", "HARHarbour", "LIGLighthouse"]);
  });

  test("offers no Find box under ten projects", async () => {
    await draw(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"]);
    await expect.element(byTestId("list-tile").nth(8)).toBeVisible();
    expect(document.querySelector('[data-testid="list-find"]')).toBeNull();
  });

  test("filters ten tiles by name or key", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
    await draw([...names, "India", "Juliet"]);
    const find = byTestId("list-find");
    await expect.element(find).toHaveAttribute("placeholder", "Find a project");
    await tile("Alpha").click();
    await find.fill("jul");
    await expect.poll(() => document.querySelectorAll('[data-testid="list-tile"]').length).toBe(1);
    await expect.element(tile("Juliet")).toBeVisible();
    /* Alpha is out of sight and still on the list. */
    await expect.element(card("ALP")).toBeVisible();
    await find.fill("IND");
    await expect.element(tile("India")).toBeVisible();
    await find.fill("zulu");
    await expect
      .element(byTestId("list-find-none"))
      .toHaveTextContent("No project matches “zulu”.");
    await find.fill("");
    await expect.element(tile("Alpha")).toHaveAttribute("aria-pressed", "true");
  });

  test("counts again as a rule changes, and warns when nothing passes", async () => {
    const { sent } = await draw(["Harbour", "Lighthouse"]);
    await tile("Harbour").click();
    const count = card("HAR").getByTestId("list-source-count");
    await expect.element(count).toHaveTextContent("3 tasks");
    await card("HAR").getByTestId("rule-add").click();
    await byTestId("filter-search").fill("Status");
    await page.getByRole("option", { name: /Status/ }).click();
    await page.getByRole("option", { name: /Todo/ }).first().click();
    await expect.element(count).toHaveTextContent("0 tasks");
    await expect
      .element(card("HAR").getByTestId("list-source-nothing"))
      .toHaveTextContent("No task passes these rules. The list will show nothing from HAR.");
    await expect
      .element(byTestId("list-summary"))
      .toHaveTextContent("1 project · 1 rule · 0 tasks");
    const asked = sent().filter((s) => s.path === "/api/lists/preview");
    expect((asked.at(-1)?.body as { filters: { rules: unknown[] } }).filters.rules).toHaveLength(1);
  });
});
