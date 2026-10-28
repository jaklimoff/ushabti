import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import type { ProjectNow } from "@/lib/queries";
import { FOLD_COOKIE, type SidebarList } from "@/lib/sidebar";
import type { BoardData } from "@/lib/types";
import { newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { at } from "@/test/next-navigation";
import { Sidebar } from "./Sidebar";
import { SidebarProvider } from "./SidebarProvider";
import styles from "./Sidebar.module.css";

/*
 * The sidebar is the one way to another project. It took the place of the
 * project-name menu, and these are that menu's tests, asked of the sidebar:
 * which projects it names, which one is open, where a press goes, and how a
 * phone reaches it. The page around it is the board, as the layout draws it.
 */

const byTestId = (id: string) => page.getByTestId(id);
const sidebar = () => byTestId("sidebar");
const square = (name: string) =>
  page.getByRole("link", { name: new RegExp(`^${name}:`) }).and(byTestId("sidebar-project"));
const card = (title: string) => byTestId("card").filter({ hasText: title });
const rectOf = (el: Element) => el.getBoundingClientRect();

const other = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function now(project: Partial<ProjectNow> & { id: string; key: string; name: string }): ProjectNow {
  return { color: "#7c8cff", waiting: 0, agents: [], lastAt: null, ...project };
}

/* A link the sidebar draws is a plain anchor in a test, and following it
   would take the whole test page away. So it is written down and not followed. */
let followed: string[] = [];
function follow(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.("a");
  if (!link) return;
  event.preventDefault();
  followed.push(link.getAttribute("href") ?? "");
}

beforeEach(() => {
  followed = [];
  document.addEventListener("click", follow);
  document.cookie = `${FOLD_COOKIE}=; path=/; max-age=0`;
});

afterEach(async () => {
  document.removeEventListener("click", follow);
  at.pathname = null;
  await page.viewport(1440, 900);
});

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/**
 * Lantern is open on the board, and Harbour is the person's other project. An
 * agent works in Harbour and another waits in it. What `/api/home/projects`
 * answers can be changed by the test, and is read on every ring.
 */
function twoProjects(more: Partial<ProjectNow> = {}) {
  const data = newProject();
  data.project.name = "Lantern";
  at.pathname = `/p/${data.project.id}`;
  const lantern = now({ ...data.project, waiting: 5 });
  const harbour = now({
    id: other(1),
    key: "HAR",
    name: "Harbour",
    color: "#c97a5a",
    agents: [
      { id: other(7), name: "Builder", taskKey: "HAR-3", reportedAt: ago(2), working: true },
    ],
    ...more,
  });
  const server = { projects: [harbour, lantern], lists: [] as SidebarList[] };
  const answer: Answer = ({ method, path }) =>
    method === "GET" && path === "/api/home/projects"
      ? { body: { projects: server.projects } }
      : method === "GET" && path === "/api/lists"
        ? { body: { lists: server.lists } }
        : undefined;
  return { data, harbour, lantern, server, answer };
}

function drawn(server: { projects: ProjectNow[]; lists: SidebarList[] }, folded = true) {
  return function Around(board: ReactNode) {
    return (
      <SidebarProvider projects={server.projects} lists={server.lists} folded={folded}>
        <div className={styles.frame}>
          <Sidebar />
          <div className={styles.page}>{board}</div>
        </div>
      </SidebarProvider>
    );
  };
}

async function draw(made: ReturnType<typeof twoProjects>, folded = true) {
  return renderWithBoard(<BoardShell initialTask={null} />, made.data, made.answer, {
    around: drawn(made.server, folded),
  });
}

describe("The folded sidebar", () => {
  test("names my projects in my order, marks this one, and opens the one I pick", async () => {
    const made = twoProjects();
    await draw(made);

    await expect.element(sidebar()).toHaveAttribute("data-folded", "true");
    expect(sidebar().element().getBoundingClientRect().width).toBe(56);
    const names = byTestId("sidebar-project")
      .elements()
      .map((a) => a.getAttribute("aria-label")?.split(":")[0]);
    expect(names).toEqual(["Harbour", "Lantern"]);
    await expect.element(square("Lantern")).toHaveAttribute("aria-current", "page");
    await expect.element(square("Harbour")).not.toHaveAttribute("aria-current");
    /* The start of the key, on the project's colour: one letter made USH
       and USHA the same square. */
    expect(square("Harbour").getByTestId("sidebar-square").element().textContent).toBe("HAR");
    /* A board is open, so Home is not marked. */
    await expect
      .element(sidebar().getByRole("link", { name: "Home", exact: true }))
      .not.toHaveAttribute("aria-current");

    await square("Harbour").click();
    expect(followed.at(-1)).toBe(`/p/${made.harbour.id}`);
  });

  test("a dot says an agent is at work, and the board's own count is the open project's", async () => {
    const made = twoProjects({ waiting: 2 });
    await draw(made);

    await expect.element(square("Harbour").getByTestId("sidebar-dot")).toBeInTheDocument();
    await expect.element(square("Harbour").getByTestId("sidebar-count")).toHaveTextContent("2");
    /* The read says five wait in Lantern; the board it is open on says none,
       and the top bar beside it says none, so the sidebar says none. */
    await gone(square("Lantern").getByTestId("sidebar-count"));
    await gone(square("Lantern").getByTestId("sidebar-dot"));
  });

  test("names the project and what is going on there in a tip, on hover and on focus", async () => {
    const made = twoProjects();
    await draw(made);
    const harbour = square("Harbour");
    await expect.element(harbour).toHaveAccessibleName("Harbour: Builder on HAR-3 · 2m");
    const tip = harbour.getByTestId("sidebar-tip");
    /* The pointer an earlier test left behind may rest on the square. */
    await page.getByTestId("top-bar").hover();
    await expect.element(tip).not.toBeVisible();
    await harbour.hover();
    await expect.element(tip).toBeVisible();
    await expect.element(tip).toHaveTextContent("HarbourBuilder on HAR-3 · 2m");
    await page.getByTestId("top-bar").hover();
    await expect.element(tip).not.toBeVisible();

    (square("Lantern").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(harbour).toHaveFocus();
    await expect.element(tip).toBeVisible();
  });

  test("is one Tab stop, and the arrows walk it", async () => {
    const made = twoProjects();
    await draw(made);
    const stops = sidebar().element().querySelectorAll('a[tabindex="0"], button[tabindex="0"]');
    /* The open project holds the stop. */
    expect([...stops].map((s) => s.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/^Lantern:/),
    ]);

    (square("Lantern").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("link", { name: "New project" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(byTestId("sidebar-fold")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect.element(sidebar().getByRole("link", { name: "Home", exact: true })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(square("Harbour")).toHaveFocus();
    /* The stop follows the focus, so Tab leaves the rail from here. */
    expect(square("Harbour").element().getAttribute("tabindex")).toBe("0");
    expect(square("Lantern").element().getAttribute("tabindex")).toBe("-1");
    await userEvent.keyboard("{Enter}");
    expect(followed.at(-1)).toBe(`/p/${made.harbour.id}`);
  });
});

describe("Folding", () => {
  test("starts folded; the button and the [ key fold and unfold it, and the device keeps it", async () => {
    const made = twoProjects();
    await draw(made);
    await expect.element(sidebar()).toHaveAttribute("data-folded", "true");

    await byTestId("sidebar-fold").click();
    await expect.element(sidebar()).toHaveAttribute("data-folded", "false");
    expect(sidebar().element().getBoundingClientRect().width).toBe(248);
    expect(document.cookie).toContain(`${FOLD_COOKIE}=open`);

    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("[[");
    await expect.element(sidebar()).toHaveAttribute("data-folded", "true");
    expect(document.cookie).toContain(`${FOLD_COOKIE}=folded`);
    await userEvent.keyboard("[[");
    await expect.element(sidebar()).toHaveAttribute("data-folded", "false");
  });

  test("[ does nothing in a text field or while a card is lifted", async () => {
    const made = twoProjects();
    withTask(made.data, "Aardvark", { Status: "Todo" });
    await draw(made);

    const box = page.getByRole("searchbox").or(page.getByRole("combobox")).first();
    await box.click();
    await userEvent.keyboard("[[");
    await expect.element(sidebar()).toHaveAttribute("data-folded", "true");

    (document.activeElement as HTMLElement | null)?.blur();
    document.body.classList.add("ushabti-dragging");
    await userEvent.keyboard("[[");
    await expect.element(sidebar()).toHaveAttribute("data-folded", "true");
    document.body.classList.remove("ushabti-dragging");
  });

  test("draws open on the first paint when the device said open", async () => {
    const made = twoProjects();
    await draw(made, false);
    await expect.element(sidebar()).toHaveAttribute("data-folded", "false");
    expect(sidebar().element().getBoundingClientRect().width).toBe(248);
  });
});

describe("The open sidebar", () => {
  test("says who works where, what waits, or Quiet, and lists my lists", async () => {
    const made = twoProjects();
    made.server.lists = [{ id: other(9), name: "Mine to do" }];
    made.server.projects.push(now({ id: other(2), key: "QUI", name: "Quiet one" }));
    made.server.projects.push(
      now({
        id: other(3),
        key: "BUS",
        name: "Busy",
        waiting: 1,
        agents: [
          { id: other(7), name: "Builder", taskKey: "BUS-1", reportedAt: ago(1), working: true },
        ],
      }),
    );
    made.server.projects.push(
      now({
        id: other(4),
        key: "TWO",
        name: "Two at work",
        agents: [
          { id: other(7), name: "Builder", taskKey: "TWO-1", reportedAt: ago(9), working: true },
          { id: other(8), name: "Scout", taskKey: "TWO-2", reportedAt: ago(3), working: true },
        ],
      }),
    );
    made.server.projects.push(
      now({
        id: other(5),
        key: "SIL",
        name: "Silent one",
        agents: [
          { id: other(8), name: "Scout", taskKey: "SIL-1", reportedAt: ago(90), working: false },
        ],
      }),
    );
    await draw(made, false);

    const line = (name: string) =>
      byTestId("sidebar-row").filter({ hasText: name }).getByTestId("sidebar-line");
    await expect.element(line("Harbour")).toHaveTextContent("Builder on HAR-3 · 2m");
    await expect.element(line("Quiet one")).toHaveTextContent("No changes yet");
    /* Waiting outranks working, and the dot still says it works. */
    await expect.element(line("Busy")).toHaveTextContent("1 waiting for you");
    await expect
      .element(byTestId("sidebar-row").filter({ hasText: "Busy" }).getByTestId("sidebar-dot"))
      .toBeInTheDocument();
    await expect.element(line("Two at work")).toHaveTextContent("Scout on TWO-2 · 3m +1");
    await expect.element(line("Silent one")).toHaveTextContent("Scout silent");
    await gone(
      byTestId("sidebar-row").filter({ hasText: "Silent one" }).getByTestId("sidebar-dot"),
    );

    /* The count and the dot stand at the row's end, off the square's letters. */
    const busy = byTestId("sidebar-row").filter({ hasText: "Busy" });
    expect(busy.getByTestId("sidebar-square").element().textContent).toBe("BUS");
    await expect.element(busy.getByTestId("sidebar-count")).toHaveTextContent("1");
    const end = rectOf(busy.getByTestId("sidebar-count").element());
    expect(end.right).toBeGreaterThan(rectOf(busy.getByTestId("sidebar-line").element()).right);

    await expect.element(byTestId("sidebar-list")).toHaveTextContent("≡Mine to do");
    await byTestId("sidebar-list").click();
    expect(followed.at(-1)).toBe(`/lists/${other(9)}`);
  });

  test("names the brand once and marks Home when you are on it", async () => {
    const made = twoProjects();
    await draw(made, false);
    const head = sidebar().getByRole("link", { name: "Ushabti", exact: true });
    await expect.element(head).toHaveAttribute("href", "/projects");
    const home = byTestId("sidebar-home");
    await expect.element(home).toHaveAccessibleName("Home");
    /* A board is open: the Home row is a way there, not where you are. */
    await expect.element(home).not.toHaveAttribute("aria-current");
    await expect
      .element(byTestId("sidebar-row").filter({ hasText: "Lantern" }))
      .toHaveAttribute("aria-current", "page");
  });

  test("on Home, the Home row and the rail's mark say you are there", async () => {
    const made = twoProjects();
    at.pathname = "/projects";
    await draw(made, false);
    await expect.element(byTestId("sidebar-home")).toHaveAttribute("aria-current", "page");
    /* No project is open, so Home is the only place marked. */
    expect(sidebar().element().querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    await byTestId("sidebar-fold").click();
    const mark = sidebar().getByRole("link", { name: "Home", exact: true });
    await expect.element(mark).toHaveAttribute("aria-current", "page");
  });

  test("the age ticks", async () => {
    const made = twoProjects();
    made.server.projects[0].agents[0].reportedAt = new Date(Date.now() - 5_000).toISOString();
    await draw(made, false);
    const line = byTestId("sidebar-row").filter({ hasText: "Harbour" }).getByTestId("sidebar-line");
    const first = line.element().textContent;
    await expect.poll(() => line.element().textContent, { timeout: 3000 }).not.toBe(first);
  });
});

describe("Following the projects", () => {
  test("a ring from another project reads them again, and the dot comes and goes", async () => {
    const made = twoProjects({ agents: [] });
    const board = await draw(made);
    await gone(square("Harbour").getByTestId("sidebar-dot"));

    made.server.projects[0] = {
      ...made.server.projects[0],
      agents: [
        { id: other(7), name: "Builder", taskKey: "HAR-4", reportedAt: ago(0), working: true },
      ],
    };
    board.elsewhere(made.harbour.id);
    await expect.element(square("Harbour").getByTestId("sidebar-dot")).toBeInTheDocument();
    await expect.element(square("Harbour")).toHaveAccessibleName(/Builder on HAR-4/);

    made.server.projects[0] = { ...made.server.projects[0], agents: [] };
    board.elsewhere(made.harbour.id);
    await gone(square("Harbour").getByTestId("sidebar-dot"));
  });

  test("holds the board's own stream and opens none of its own", async () => {
    const made = twoProjects();
    const board = await draw(made);
    expect(board.streams()).toEqual([
      expect.stringContaining(`/api/projects/${made.data.project.id}/stream`),
    ]);
  });

  test("is not drawn with one project and no list, and comes with a second", async () => {
    const made = twoProjects();
    made.server.projects = [made.lantern];
    const board = await draw(made);
    await gone(sidebar());

    made.server.projects = [made.harbour, made.lantern];
    board.elsewhere(made.harbour.id);
    await expect.element(sidebar()).toBeVisible();
  });

  test("a first list brings it too", async () => {
    const made = twoProjects();
    made.server.projects = [made.lantern];
    made.server.lists = [{ id: other(9), name: "Mine to do" }];
    await draw(made);
    await expect.element(sidebar()).toBeVisible();
  });
});

describe("On a phone", () => {
  test("the sidebar is not in the page; the project mark opens it as a sheet", async () => {
    await page.viewport(390, 780);
    const made = twoProjects();
    await draw(made);

    await expect.element(sidebar()).not.toBeVisible();
    await byTestId("sidebar-sheet-open").click();
    const sheet = page.getByRole("menu", { name: "Projects" });
    await expect.element(sheet).toBeVisible();
    const box = sheet.element().getBoundingClientRect();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect.element(page.getByRole("menuitem", { name: "Home" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "New project" })).toBeVisible();

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("menuitem", { name: /^Harbour:/ })).toHaveFocus();
    await page.getByRole("menuitem", { name: /^Harbour:/ }).click();
    expect(followed.at(-1)).toBe(`/p/${made.harbour.id}`);
    await gone(sheet);
  });

  /* A question from the pick bar takes the last of a small tablet's bar,
     the mark included, and nothing is pushed off it. */
  test("the mark makes room for the pick bar's question", async () => {
    await page.viewport(540, 820);
    const made = twoProjects();
    for (const title of ["Aardvark", "Beetle"]) withTask(made.data, title, { Status: "Todo" });
    await draw(made);

    const pill = page.getByRole("button", { name: "Show the column Todo" });
    if (pill.elements().length) await pill.click();
    for (const title of ["Aardvark", "Beetle"]) {
      await card(title).getByTestId("card-pick").click();
    }
    await expect.element(byTestId("sidebar-sheet-open")).toBeVisible();
    await byTestId("pick-archive").click();
    await expect.element(byTestId("sidebar-sheet-open")).not.toBeVisible();
  });
});

/* The bar's project name is words and nothing else now. */
describe("The project name", () => {
  test("is plain text on the board", async () => {
    const made: { data: BoardData } = twoProjects();
    await draw(made as ReturnType<typeof twoProjects>);
    await expect.element(byTestId("board-crumb")).toHaveTextContent("Lantern");
    expect(byTestId("board-crumb").element().closest("button, a")).toBeNull();
    await gone(byTestId("project-switcher"));
  });
});
