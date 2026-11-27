import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The strong row lock conflicts with the key share a foreign key check takes,
 * so a feed line or a comment on a locked row waited, and a move and a value
 * write on one card deadlocked. Every lock in the app is the no-key kind.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sources(full);
    if (!/\.(ts|tsx|mjs|js)$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

const STRONG = [/for\s+update/i, /\.for\(\s*["']update["']/];

describe("row locks", () => {
  it("are never the kind that blocks a foreign key check", () => {
    const found = sources(path.join(process.cwd(), "src")).filter((file) => {
      const text = readFileSync(file, "utf8");
      return STRONG.some((re) => re.test(text));
    });
    expect(found.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("sees a strong lock when there is one", () => {
    expect(STRONG.some((re) => re.test("select 1 from x for update"))).toBe(true);
    expect(STRONG.some((re) => re.test('.for("update")'))).toBe(true);
    expect(STRONG.some((re) => re.test("for no key update"))).toBe(false);
  });
});
