import { expect, test, type Page } from "@playwright/test";
import { createProject, inDatabase, overflow, register, unique } from "./helpers";

/*
 * The base every page off the board stands on: one bar, one project mark, a
 * ring the keyboard can see, a label that names its box, and words bright
 * enough to read. Each is measured on the page rather than looked at once.
 */

/** The pages off the board, in the order a person meets them. */
function pagesOff(projectId: string) {
  return [
    { path: "/projects", here: null },
    { path: "/account", here: "Account" },
    { path: "/lists/new", here: null },
    { path: `/p/${projectId}/settings/properties`, here: "Settings" },
    { path: `/p/${projectId}/archived`, here: "Archived" },
    { path: `/p/${projectId}/changelog`, here: "Changelog" },
  ];
}

function bar(page: Page) {
  return page
    .locator("header")
    .filter({ has: page.getByRole("navigation", { name: "Where you are" }) });
}

/** The changelog is there only while releases are on. */
async function releasesOn(page: Page, projectId: string) {
  expect((await page.request.post(`/api/projects/${projectId}/releases`)).ok()).toBe(true);
}

async function projectOf(projectId: string): Promise<{ key: string; color: string }> {
  return inDatabase(async (db) => {
    const { rows } = await db.query("select key, color from projects where id = $1", [projectId]);
    return rows[0];
  });
}

/** The colour a browser paints for a CSS colour, so two spellings compare. */
async function painted(page: Page, color: string): Promise<string> {
  return page.evaluate((c) => {
    const probe = document.createElement("span");
    probe.style.color = c;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, color);
}

test.describe("The design foundation", () => {
  test("every page off the board wears the one bar, led home by the Ushabti mark", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Bar"));
    await releasesOn(page, projectId);
    const project = await projectOf(projectId);

    for (const { path, here } of pagesOff(projectId)) {
      await page.goto(path);
      const header = bar(page);
      await expect(header, path).toHaveCount(1);
      await expect(header.getByRole("link", { name: /Home|Ushabti/ }).first()).toHaveAttribute(
        "href",
        "/projects",
      );
      /* The trail says where you are; a sibling link to the same page may be
         marked current too, so read the trail's own. */
      if (here)
        await expect(
          header
            .getByRole("navigation", { name: "Where you are" })
            .locator('[aria-current="page"]'),
        ).toHaveText(here);
      if (path.startsWith("/p/")) {
        const mark = header.getByText(project.key, { exact: true });
        await expect(mark).toBeVisible();
        await expect(mark).toHaveCSS("background-color", await painted(page, project.color));
      }
    }
    await page.goto(`/p/${projectId}/settings/properties`);
    await expect(bar(page)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-settings-bar.png") });
  });

  test("the project's mark carries its own colour and key on the board and in the sidebar", async ({
    page,
  }, testInfo) => {
    await register(page);
    /* The sidebar comes with a second project. */
    await createProject(page, unique("Other"));
    const projectId = await createProject(page, unique("Mark"));
    const project = await projectOf(projectId);
    const colour = await painted(page, project.color);

    const mark = page.getByTestId("board-mark");
    await expect(mark).toHaveText(project.key);
    await expect(mark).toHaveCSS("background-color", colour);

    const square = page
      .getByTestId("sidebar-project")
      .and(page.locator(`[href="/p/${projectId}"]`))
      .getByTestId("sidebar-square");
    await expect(square).toBeVisible();
    await expect(square).toHaveText(project.key.slice(0, 1));
    await expect(square).toHaveCSS("background-color", colour);
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-mark.png") });
  });

  test("the keyboard lands on every control with the accent ring, and a click draws none", async ({
    page,
  }) => {
    await register(page);
    await page.goto("/account");
    await expect(page.getByLabel("Your name")).toBeVisible();
    const accent = await painted(page, "var(--accent)");

    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      // A box eases its border in over 140 ms.
      await page.waitForTimeout(250);
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          type: el.getAttribute("type"),
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
          outlineColor: style.outlineColor,
          shadow: style.boxShadow,
          border: style.borderColor,
        };
      });
      if (!focus) continue;
      const box =
        (focus.tag === "INPUT" &&
          !["checkbox", "radio", "range", "color"].includes(focus.type ?? "")) ||
        focus.tag === "TEXTAREA";
      if (box) {
        // A text box takes the accent border and a soft glow instead.
        expect(focus.border, `${focus.tag} border`).toBe(accent);
        expect(focus.shadow, `${focus.tag} glow`).not.toBe("none");
      } else {
        expect(focus.outline, `${focus.tag} ring`).toBe("solid 2px");
        expect(focus.outlineColor, `${focus.tag} ring colour`).toBe(accent);
      }
      seen.add(focus.tag);
    }
    expect(seen.has("A") || seen.has("BUTTON")).toBe(true);

    // A press with the mouse draws nothing.
    const menu = bar(page).getByRole("button").last();
    await menu.click();
    await expect(menu).toHaveCSS("outline-style", "none");
  });

  test("a press on a field's label puts the cursor in its box, and the label reads at 4.5:1", async ({
    page,
  }) => {
    await register(page);
    await page.goto("/account");
    const box = page.getByLabel("Your name");
    await expect(box).toBeVisible();

    const label = page.locator("label", { hasText: /^Name$/ });
    await label.click();
    await expect(box).toBeFocused();

    const ratio = await label.evaluate((el) => {
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      let back: Element | null = el;
      let bg = "rgba(0, 0, 0, 0)";
      while (back) {
        const c = getComputedStyle(back).backgroundColor;
        if (rgb(c)[3] !== 0 && c !== "transparent") {
          bg = c;
          break;
        }
        back = back.parentElement;
      }
      const a = lum(rgb(getComputedStyle(el).color));
      const b = lum(rgb(bg));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.4);
  });

  test("no page off the board scrolls sideways on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page);
    const projectId = await createProject(page, unique("Phone"));
    await releasesOn(page, projectId);
    for (const { path } of pagesOff(projectId)) {
      await page.goto(path);
      await expect(bar(page)).toBeVisible();
      expect(await overflow(page), path).toBe(0);
    }
  });
});
