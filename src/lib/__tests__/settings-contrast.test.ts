import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The small mono words of settings are read on the card, so their colour has
 * to stand off it. Read from the stylesheets themselves, so a token swapped
 * back to a fainter one fails here and not in somebody's eyes.
 */

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const tokens = new Map(
  [...read("app/globals.css").matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]),
);

/** The colour a rule gives, with its token resolved. */
function colourOf(path: string, selector: string): string {
  const css = read(path);
  const at = css.search(new RegExp(`^\\${selector}\\s*\\{`, "m"));
  expect(at, `${selector} in ${path}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf("}", at));
  const value = /\bcolor:\s*([^;]+);/.exec(body)?.[1].trim() ?? "";
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return token ? (tokens.get(token) ?? "") : value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("settings words on the card", () => {
  const card = tokens.get("--bg-card")!;

  it.each([
    ["components/ui/ui.module.css", ".fieldLabel"],
    ["components/settings/settings.module.css", ".railItem"],
    ["components/settings/settings.module.css", ".memberMail"],
    ["components/settings/settings.module.css", ".cardFieldLabel"],
  ])("%s %s stands at least 4:1 off the card", (path, selector) => {
    expect(contrast(colourOf(path, selector), card)).toBeGreaterThanOrEqual(4);
  });
});
