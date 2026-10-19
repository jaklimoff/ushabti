import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A colour that means a token reads the token, so one change of it reaches
 * every place. These were once written by hand beside the token they meant.
 */

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function bodyOf(path: string, selector: string): string {
  const css = read(path);
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} in ${path}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("colours in the modules", () => {
  it.each([
    ["components/ui/ui.module.css", ".inputInvalid:focus", "--danger-ring"],
    ["components/ui/ui.module.css", ".toastError", "--danger-line"],
    ["components/ui/ui.module.css", ".copyDone", "--done-line"],
    ["components/ui/ui.module.css", ".nameInput:hover:not(:disabled)", "--bg-seg"],
    ["components/board/panel.module.css", ".title:hover", "--bg-hover-wash"],
    ["components/board/panel.module.css", ".fileOpen:hover", "--bg-hover-wash"],
    ["components/board/panel.module.css", ".changed", "--danger-wash"],
    ["components/board/panel.module.css", ".markdown blockquote", "--accent-wash"],
    ["components/board/board.module.css", ".listRunAgent", "--agent-text"],
  ])("%s %s reads %s", (path, selector, token) => {
    expect(bodyOf(path, selector)).toContain(`var(${token})`);
  });

  it("the run strip's words and a list row's agent read the same teal", () => {
    const strip = bodyOf("components/board/board.module.css", ".runStrip");
    expect(strip).toContain("--run-text: var(--agent-text);");
    expect(strip).toContain("--run-time: var(--agent-time);");
    const waiting = bodyOf(
      "components/board/board.module.css",
      '.runStrip[data-status="handed_over"]',
    );
    expect(waiting).toContain("--run-text: var(--agent-waiting-text);");
  });

  it("no hand-written copy of these is left", () => {
    const modules = ["ui/ui.module.css", "board/panel.module.css", "board/board.module.css"].map(
      (p) => read(`components/${p}`),
    );
    for (const css of modules)
      for (const hand of [
        "rgba(224, 87, 77",
        "rgba(79, 138, 91",
        "#131518",
        "#1b1f24",
        "rgba(255, 255, 255, 0.04)",
        "rgba(63, 176, 200, 0.05)",
        "#94b6bf",
        "#6a8f99",
        "#e3c3a0",
        "#6fbfd2",
      ])
        expect(css).not.toContain(hand);
  });

  it("--radius is gone, and --r-md is the middle step", () => {
    expect(read("app/globals.css")).not.toMatch(/--radius\b/);
    expect(read("app/globals.css")).toContain("--r-md: 8px;");
  });
});
