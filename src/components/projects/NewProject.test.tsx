import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ME, newProject, renderWithBoard, type Answer } from "@/test/board";
import { pushed } from "@/test/next-navigation";
import { NewProject, type SetupSource } from "./NewProject";

const made: Answer = (sent) =>
  sent.method === "POST" && sent.path === "/api/projects"
    ? { body: { project: { id: "p-new" } } }
    : undefined;

async function draw(answer: Answer = made, sources: SetupSource[] = []) {
  return renderWithBoard(<NewProject user={ME} sources={sources} />, newProject(), answer);
}

const ROADMAP: SetupSource = {
  id: "p-roadmap",
  key: "USH",
  name: "Ushabti roadmap",
  color: "#2f6fde",
  line: "From Ushabti roadmap: 8 properties with their options, 4 views, the card, the agent rules, releases on, sprints off. Releases start with no versions. Tasks, people and webhooks stay behind.",
};
const SITE: SetupSource = {
  id: "p-site",
  key: "WEB",
  name: "Website",
  color: "#c2410c",
  line: "From Website: 6 properties with their options, 2 views, releases off, sprints off. Tasks, people and webhooks stay behind.",
};

beforeEach(() => {
  pushed.length = 0;
});

describe("The New project page", () => {
  test("says what a project is, and opens on the name", async () => {
    await draw();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "New project" }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "A project is one board of tasks, shared with the people and agents you invite.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Project name" })).toHaveFocus();
    const form = page.getByRole("form", { name: "New project" });
    expect(
      form
        .getByText(/^(Name|Key)$/)
        .elements()
        .map((el) => el.textContent),
    ).toEqual(["Name", "Key"]);
    /* Cancel goes Home, then the primary at the right. */
    await expect
      .element(form.getByRole("link", { name: "Cancel" }))
      .toHaveAttribute("href", "/projects");
    await expect.element(form.getByRole("button", { name: "Create project" })).toBeVisible();
  });

  test("fills the key in when the name is left, and the note follows it", async () => {
    const { sent } = await draw();
    const form = page.getByRole("form", { name: "New project" });
    const said = () => form.element().textContent ?? "";
    expect(said()).toContain(
      "Task keys will look like WR-14. Changing the key later renames every task.",
    );
    const nameBox = page.getByRole("textbox", { name: "Project name" });
    const keyBox = page.getByRole("textbox", { name: "Project key" });
    await userEvent.type(nameBox, "Harbour lights");
    await expect.poll(said).toContain("Task keys will look like HL-14.");
    /* The key never flickers while somebody types. */
    await expect.element(keyBox).toHaveValue("");
    await userEvent.tab();
    await expect.element(keyBox).toHaveValue("HL");
    await userEvent.clear(keyBox);
    await userEvent.type(keyBox, "har");
    await expect.poll(said).toContain("Task keys will look like HAR-14.");
    /* Nothing went out before the press. */
    expect(sent().filter((s) => s.method !== "GET")).toEqual([]);

    await form.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => pushed).toEqual(["/p/p-new"]);
    expect(
      sent()
        .filter((s) => s.method === "POST")
        .map((s) => s.body),
    ).toEqual([{ name: "Harbour lights", key: "HAR" }]);
  });

  test("an empty name says so under the box and takes the focus", async () => {
    const { sent } = await draw();
    const nameBox = page.getByRole("textbox", { name: "Project name" });
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.element(page.getByText("Give the project a name.")).toBeVisible();
    await expect.element(nameBox).toHaveFocus();
    await expect.element(nameBox).toHaveAttribute("aria-invalid", "true");
    expect(sent().filter((s) => s.method === "POST")).toEqual([]);
  });

  test("a server error lands on the box it is about", async () => {
    await draw((sent) =>
      sent.method === "POST"
        ? { status: 409, body: { error: "That key is taken by another project." } }
        : undefined,
    );
    await userEvent.type(page.getByRole("textbox", { name: "Project name" }), "Harbour");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Project key" }))
      .toHaveAttribute("aria-invalid", "true");
    await expect.element(page.getByText("That key is taken by another project.")).toBeVisible();
    expect(pushed).toEqual([]);
  });

  test("starts with the default set, and sends no source", async () => {
    const { sent } = await draw(made, [ROADMAP, SITE]);
    await expect.element(page.getByRole("radio", { name: "Default set" })).toBeChecked();
    await expect
      .element(page.getByRole("radio", { name: "The same setup as another project" }))
      .not.toBeChecked();
    expect(page.getByTestId("setup-tile").elements()).toHaveLength(0);
    await userEvent.type(page.getByRole("textbox", { name: "Project name" }), "Harbour");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => pushed).toEqual(["/p/p-new"]);
    expect(
      sent()
        .filter((s) => s.method === "POST")
        .map((s) => s.body),
    ).toEqual([{ name: "Harbour", key: "HAR" }]);
  });

  test("another project's setup shows the tiles, asks for one, and says what comes over", async () => {
    const { sent } = await draw(made, [ROADMAP, SITE]);
    await userEvent.type(page.getByRole("textbox", { name: "Project name" }), "Harbour");
    await page.getByRole("radio", { name: "The same setup as another project" }).click();
    const tiles = page.getByTestId("setup-tile");
    expect(tiles.elements().map((t) => t.textContent)).toEqual([
      "USHUshabti roadmap",
      "WEBWebsite",
    ]);
    expect(page.getByTestId("setup-line").elements()).toHaveLength(0);

    /* None picked: it says so under the tiles and writes nothing. */
    await page.getByRole("button", { name: "Create project" }).click();
    await expect
      .element(page.getByText("Pick the project whose setup to start with."))
      .toBeVisible();
    await expect.element(tiles.first()).toHaveFocus();
    expect(sent().filter((s) => s.method === "POST")).toEqual([]);

    await tiles.first().click();
    await expect.element(page.getByTestId("setup-line")).toHaveTextContent(ROADMAP.line);
    await tiles.nth(1).click();
    await expect.element(page.getByTestId("setup-line")).toHaveTextContent(SITE.line);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => pushed).toEqual(["/p/p-new"]);
    expect(
      sent()
        .filter((s) => s.method === "POST")
        .map((s) => s.body),
    ).toEqual([{ name: "Harbour", key: "HAR", from: "p-site" }]);
  });

  test("with one project, it is picked already", async () => {
    await draw(made, [ROADMAP]);
    await page.getByRole("radio", { name: "The same setup as another project" }).click();
    await expect.element(page.getByTestId("setup-tile")).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByTestId("setup-line")).toHaveTextContent(ROADMAP.line);
  });

  test("going back to the default set sends no source", async () => {
    const { sent } = await draw(made, [ROADMAP]);
    await userEvent.type(page.getByRole("textbox", { name: "Project name" }), "Harbour");
    await page.getByRole("radio", { name: "The same setup as another project" }).click();
    await page.getByRole("radio", { name: "Default set" }).click();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => pushed).toEqual(["/p/p-new"]);
    expect(sent().find((s) => s.method === "POST")?.body).toEqual({ name: "Harbour", key: "HAR" });
  });
});
