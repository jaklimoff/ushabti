import type { ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import SettingsIndex from "@/app/p/[projectId]/settings/page";
import type { BoardData } from "@/lib/types";
import { ME, newProject, renderWithBoard } from "@/test/board";
import { at, pushed } from "@/test/next-navigation";
import { PeoplePanel } from "./PeoplePanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { SettingsShell } from "./SettingsShell";
import { ViewsPanel } from "./ViewsPanel";

/*
 * The frame around every settings page: the bar and the menu of sections.
 * Each test here was a test of `e2e/settings.spec.ts`, and its name is the
 * name it had there.
 */

/** Draws a settings page at `/p/{id}/settings/{slug}`, as the layout does. */
async function drawAt(slug: string, panel: ReactNode, data: BoardData = newProject()) {
  at.pathname = `/p/${data.project.id}/settings/${slug}`;
  return renderWithBoard(
    <SettingsShell initial={data} user={ME} version="0.0.0">
      {panel}
    </SettingsShell>,
    data,
    ({ method, path }) => {
      if (method !== "GET") return undefined;
      if (path.endsWith("/settings")) return { body: data };
      // People asks for its agents, and this project has none.
      if (path.endsWith("/agents")) return { body: { agents: [] } };
    },
  );
}

const rail = () => page.getByRole("navigation", { name: "Settings sections" });

function overflow(): number {
  const doc = document.documentElement;
  return Math.max(doc.scrollWidth - doc.clientWidth, 0);
}

afterEach(async () => {
  at.pathname = null;
  await page.viewport(1440, 900);
});

describe("Settings", () => {
  test("each section has its own address", async () => {
    const data = newProject();
    const base = `/p/${data.project.id}/settings`;

    // Settings with no section opens on Properties.
    pushed.length = 0;
    await expect(
      SettingsIndex({ params: Promise.resolve({ projectId: data.project.id }) }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(pushed).toEqual([`${base}/properties`]);

    // Each item of the menu is a link to its own page, and the page it is on is lit.
    await drawAt("people", <PeoplePanel mail={false} />, data);
    const people = rail().getByRole("link", { name: /^People/ });
    await expect.element(people).toHaveAttribute("href", `${base}/people`);
    await expect.element(people).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByRole("heading", { name: "People" })).toBeVisible();

    const views = rail().getByRole("link", { name: /^Views/ });
    await expect.element(views).toHaveAttribute("href", `${base}/views`);
    expect(views.element().getAttribute("aria-current")).toBeNull();
  });
});

describe("Settings on a phone", () => {
  test("the menu fades at its right edge while there is more of it", async () => {
    await page.viewport(390, 780);
    await drawAt("properties", <PropertiesPanel />);

    const nav = rail().element() as HTMLElement;
    await expect.element(rail()).toHaveAttribute("data-more", "true");
    expect(getComputedStyle(nav).maskImage).not.toBe("none");

    nav.scrollTo({ left: nav.scrollWidth });
    await expect.element(rail()).not.toHaveAttribute("data-more");
    expect(getComputedStyle(nav).maskImage).toBe("none");
  });

  test("the page that opens has its menu item in view", async () => {
    await page.viewport(390, 780);
    await drawAt("project", <ViewsPanel />);

    const here = rail().element().querySelector<HTMLElement>('[aria-current="page"]');
    expect(here?.textContent).toBe("Project");
    await expect
      .poll(() => {
        const r = rail().element().getBoundingClientRect();
        const h = here!.getBoundingClientRect();
        // A pixel for rounding: the last item ends where the rail does.
        return h.x >= r.x - 1 && h.x + h.width <= r.x + r.width + 1;
      })
      .toBe(true);
  });
});

/* The bar over settings carries the same name as the board's, so it keeps it
   at the same width. */
describe("Settings on a small tablet", () => {
  test("the bar keeps the person's name", async () => {
    await page.viewport(560, 820);
    await drawAt("views", <ViewsPanel />);

    const person = page.getByTestId("user-name");
    await expect.element(person).toBeVisible();
    await expect.element(person).toHaveTextContent(ME.name);
    expect(overflow()).toBe(0);
  });
});
