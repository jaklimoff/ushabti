import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VIEW_KINDS } from "../types";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

/* A type leaves nothing at run time, so its keys come from the source the
   compiler reads. A key added there is a key the docs owe. */
function keysOf(type: string): string[] {
  const source = read("src/lib/types.ts");
  const body = source.match(new RegExp(`export type ${type} = \\{([^}]*)\\};`))?.[1];
  if (!body) throw new Error(`No type ${type} in src/lib/types.ts`);
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
}

const named = (doc: string, word: string) =>
  doc.includes(`\`${word}\``) || doc.includes(`"${word}"`);

describe("the agent docs follow the code", () => {
  it("name every field of an archived entry", () => {
    const keys = keysOf("ArchivedTaskDTO");
    expect(keys).toContain("shippedIn");
    for (const page of ["docs/agents.md", "website/src/content/docs/api/board.mdx"]) {
      const doc = read(page);
      expect(
        keys.filter((k) => !named(doc, k)),
        page,
      ).toEqual([]);
    }
  });

  it("name every kind of view", () => {
    for (const page of ["docs/agents.md", "website/src/content/docs/api/properties.mdx"]) {
      const doc = read(page);
      expect(
        VIEW_KINDS.filter((k) => !named(doc, k)),
        page,
      ).toEqual([]);
    }
  });
});
