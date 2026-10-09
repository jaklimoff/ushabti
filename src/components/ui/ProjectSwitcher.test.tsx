import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { Archive } from "@/components/archive/Archive";
import { BoardShell } from "@/components/board/BoardApp";
import { ProjectList } from "@/components/projects/ProjectList";
import { SettingsShell } from "@/components/settings/SettingsShell";
import type { BoardData } from "@/lib/types";
import { ME, newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { pushed } from "@/test/next-navigation";

/*
 * The project name is the one way to another project. It used to be the user
 * menu, then a whole page, then a click: four steps for a person who does it
 * many times a day. Each test here was a test of `e2e/switcher.spec.ts`, and
 * its name is the name it had there. Where the spec waited for the next
 * page, this reads where the press went: a link followed, or a route pushed.
 */

const byTestId = (id: string) => page.getByTestId(id);
const switcher = () => byTestId("project-switcher");
const menu = () => page.getByRole("menu", { name: "Projects" });
const card = (title: string) => byTestId("card").filter({ hasText: title });

type Listed = { id: string; key: string; name: string };

/** The id of a project that is not the open one. */
const other = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

/** `GET /api/projects` answers the open project and `more` after it. */
function listing(data: BoardData, more: Listed[]): Answer {
  return ({ method, path }) =>
    method === "GET" && path === "/api/projects"
      ? { body: { projects: [...more, { ...data.project }] } }
      : undefined;
}

/* A link the menu draws is a plain anchor in a test, and following it would
   take the whole test page away. So it is written down and not followed. */
let followed: string[] = [];
function follow(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.("a");
  if (!link) return;
  event.preventDefault();
  followed.push(link.getAttribute("href") ?? "");
}
/** Where the last press went: a link followed, or a route pushed. */
const went = () => [...followed, ...pushed].at(-1);

beforeEach(() => {
  followed = [];
  pushed.length = 0;
  document.addEventListener("click", follow);
});

afterEach(async () => {
  document.removeEventListener("click", follow);
  await page.viewport(1440, 900);
});

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** How far the page can be pushed sideways. A phone has nowhere to push it. */
function overflow(): number {
  const doc = document.documentElement;
  return Math.max(doc.scrollWidth - doc.clientWidth, 0);
}

/** How far anything on the board's top bar reaches past the bar's own padding. */
function pastTheBar(): number {
  const bar = document.querySelector('[data-testid="top-bar"]')!;
  const style = getComputedStyle(bar);
  const at = bar.getBoundingClientRect();
  const left = at.left + parseFloat(style.paddingLeft);
  const right = at.right - parseFloat(style.paddingRight);
  let past = 0;
  for (const el of bar.querySelectorAll("*")) {
    const one = el.getBoundingClientRect();
    if (one.width <= 0) continue;
    past = Math.max(past, one.right - right, left - one.left);
  }
  return Math.max(Math.round(past), 0);
}

/** Two projects, Harbour and the open one, Lantern, on the board. */
function twoProjects() {
  const data = newProject();
  data.project.name = "Lantern";
  const harbour = { id: other(1), key: "HAR", name: "Harbour" };
  return { data, harbour, answer: listing(data, [harbour]) };
}

describe("The project switcher", () => {
  test("lists my projects, marks this one, and opens the one I pick", async () => {
    const { data, harbour, answer } = twoProjects();
    await renderWithBoard(<BoardShell initialTask={null} />, data, answer);

    await switcher().click();
    await expect.element(menu()).toBeVisible();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Lantern" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("menuitemradio", { name: "Harbour" }))
      .toHaveAttribute("aria-checked", "false");
    await expect.element(page.getByRole("menuitem", { name: "New project" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Home" })).toBeVisible();
    /* Eight projects or fewer need no box. */
    await gone(byTestId("project-switcher-find"));

    await page.getByRole("menuitemradio", { name: "Harbour" }).click();
    expect(went()).toBe(`/p/${harbour.id}`);
    await gone(menu());

    /* The user menu no longer holds a second way to the same place. */
    await byTestId("user-name").click();
    await expect.element(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    await gone(page.getByRole("menuitem", { name: "Home" }));
    await userEvent.keyboard("{Escape}");
  });

  test("lists my own lists under the projects, and opens the one I pick", async () => {
    const { data, harbour } = twoProjects();
    const mine = { id: other(9), name: "Mine to do" };
    const projects = listing(data, [harbour]);
    const answer: Answer = (req) =>
      req.method === "GET" && req.path === "/api/lists"
        ? { body: { lists: [mine] } }
        : projects(req);
    await renderWithBoard(<BoardShell initialTask={null} />, data, answer);

    await switcher().click();
    const row = page.getByRole("menuitem", { name: "Mine to do" });
    await expect.element(row).toBeVisible();
    /* Under the projects, above the ways out. */
    const items = Array.from(document.querySelectorAll('[role="menu"] a')).map(
      (a) => a.textContent ?? "",
    );
    const at = items.findIndex((t) => t.includes("Mine to do"));
    expect(items.findIndex((t) => t.includes("Harbour"))).toBeLessThan(at);
    expect(items.findIndex((t) => t.includes("New project"))).toBeGreaterThan(at);

    await row.click();
    expect(went()).toBe(`/lists/${mine.id}`);
  });

  test("walks with the arrow keys, opens with Enter and gives the focus back", async () => {
    const { data, harbour, answer } = twoProjects();
    await renderWithBoard(<BoardShell initialTask={null} />, data, answer);

    (switcher().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(menu()).toHaveFocus();

    /* Escape puts it away and the focus is back on the name. */
    await userEvent.keyboard("{Escape}");
    await gone(menu());
    await expect.element(switcher()).toHaveFocus();

    /* The highlight starts on this project. Up goes to the one before it. */
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(menu()).toHaveFocus();
    /* The menu opens on this project alone and the list follows. A walk
       before it arrives would wrap onto All projects. */
    await expect.poll(() => page.getByRole("menuitemradio").elements().length).toBe(2);
    await userEvent.keyboard("{ArrowUp}");
    const at = menu().element().getAttribute("aria-activedescendant")!;
    expect(document.getElementById(at)?.textContent).toContain("Harbour");
    await userEvent.keyboard("{Enter}");
    expect(went()).toBe(`/p/${harbour.id}`);
  });

  test("is the same menu in Settings and Archived, and the name is not a link", async () => {
    const data = newProject();
    data.project.name = "Harbour";
    const answer = listing(data, []);

    for (const screen of [
      <SettingsShell key="settings" initial={data} user={ME} version="test">
        <div />
      </SettingsShell>,
      <Archive key="archived" initial={data} deleted={[]} user={ME} />,
    ]) {
      const drawn = await renderWithBoard(screen, data, answer);
      await expect.element(switcher()).toBeVisible();
      await gone(page.getByRole("link", { name: "Harbour" }));
      await expect.element(page.getByRole("link", { name: "Back to board" })).toBeVisible();
      await switcher().click();
      await expect
        .element(page.getByRole("menuitemradio", { name: "Harbour" }))
        .toHaveAttribute("aria-checked", "true");
      await userEvent.keyboard("{Escape}");
      await expect.element(switcher()).toHaveFocus();

      /* New project opens the one form there is. */
      await switcher().click();
      await page.getByRole("menuitem", { name: "New project" }).click();
      expect(went()).toBe("/projects?new");
      await drawn.screen.unmount();
    }

    /* And it is already open when it gets there. */
    await renderWithBoard(<ProjectList user={ME} adding projects={[]} />, data);
    await expect.element(page.getByPlaceholder("Project name")).toHaveFocus();
  });

  test("shows a box to find a project only past eight", async () => {
    const data = newProject();
    data.project.name = "Harbour";
    const spare = Array.from({ length: 8 }, (_, i) => ({
      id: other(10 + i),
      key: `SP${i}`,
      name: `Spare ${i}`,
    }));
    await renderWithBoard(<BoardShell initialTask={null} />, data, listing(data, spare));

    await switcher().click();
    const find = byTestId("project-switcher-find");
    await expect.element(find).toHaveFocus();
    await expect.poll(() => page.getByRole("menuitemradio").elements().length).toBe(9);

    await find.fill("spare 7");
    await expect.poll(() => page.getByRole("menuitemradio").elements().length).toBe(1);
    await userEvent.keyboard("{Enter}");
    expect(went()).toBe(`/p/${spare[7].id}`);
  });
});

describe("The project switcher on a phone", () => {
  test("opens from the mark and stays on the screen", async () => {
    await page.viewport(390, 780);
    const { data, harbour, answer } = twoProjects();
    await renderWithBoard(<BoardShell initialTask={null} />, data, answer);

    /* The name is gone at this width; the mark is the button. */
    await expect.element(byTestId("board-crumb")).not.toBeVisible();
    await expect.element(byTestId("board-mark")).toBeVisible();
    await switcher().click();

    const box = menu().element().getBoundingClientRect();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(overflow()).toBe(0);

    await page.getByRole("menuitemradio", { name: "Harbour" }).click();
    expect(went()).toBe(`/p/${harbour.id}`);
  });
});

/* A question from the pick bar takes the last of a small tablet's bar, the
   mark included. The mark is the switcher's button, so the caret must not
   stay behind alone and take that room back. */
describe("The project switcher while the pick bar asks", () => {
  test("goes with the mark, and nothing is pushed off the bar", async () => {
    await page.viewport(540, 820);
    const data = newProject();
    for (const title of ["Aardvark", "Beetle"]) withTask(data, title, { Status: "Todo" });
    const user = { ...ME, name: "Wilhelmina Featherstonehaugh" };
    data.members[0].name = user.name;
    await renderWithBoard(<BoardShell initialTask={null} />, data, undefined, { user });

    const pill = page.getByRole("button", { name: "Show the column Todo" });
    if (pill.elements().length) await pill.click();
    for (const title of ["Aardvark", "Beetle"]) {
      await card(title).getByTestId("card-pick").click();
    }
    await expect.element(switcher()).toBeVisible();

    await byTestId("pick-archive").click();
    await expect.element(switcher()).not.toBeVisible();
    expect(pastTheBar()).toBe(0);
  });
});
