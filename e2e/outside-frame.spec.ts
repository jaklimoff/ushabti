import { expect, test, type Page } from "@playwright/test";

/*
 * The sign-in pages and the status pages hang in one frame: the same glow,
 * the same height, the same column and the same card box. A dead invite or
 * reset token is any token at all.
 */

const PAGES = [
  ["login", "/login"],
  ["register", "/register"],
  ["forgot", "/forgot"],
  ["invite", "/invite/ushi_nothing-was-ever-made-with-this"],
  ["reset", "/reset/ushr_nothing-was-ever-made-with-this"],
  ["not-found", "/no-such-page-anywhere"],
] as const;

const SIZES = [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const;

async function frameOf(page: Page) {
  return page.locator("main").evaluate((main) => {
    const card = main.querySelector("section")!;
    const m = getComputedStyle(main);
    const c = getComputedStyle(card);
    const box = card.getBoundingClientRect();
    return {
      paddingTop: m.paddingTop,
      background: m.backgroundImage,
      columnX: Math.round(card.parentElement!.getBoundingClientRect().x),
      columnWidth: Math.round(card.parentElement!.getBoundingClientRect().width),
      cardX: Math.round(box.x),
      cardWidth: Math.round(box.width),
      cardPadding: c.padding,
      cardGround: c.backgroundColor,
      cardLine: c.border,
      cardRadius: c.borderRadius,
    };
  });
}

test.describe("The outside frame", () => {
  for (const [size, viewport] of SIZES) {
    test(`is one frame on every sign-in and status page at ${size} width`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const frames = [];
      for (const [name, path] of PAGES) {
        await page.goto(path);
        await expect(page.locator("main section")).toBeVisible();
        frames.push(await frameOf(page));
        // A focus ring caught mid-transition would differ from run to run.
        await page.screenshot({
          path: testInfo.outputPath(`seen-${name}-${size}.png`),
          animations: "disabled",
        });
      }
      for (const frame of frames) expect(frame).toEqual(frames[0]);
    });
  }
});
