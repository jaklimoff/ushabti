import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A person picks a colour of their own from the palette. The route is read as
 * a client reads it; the database remembers what the update set.
 */
const fake = vi.hoisted(() => {
  const state = { set: [] as Record<string, unknown>[] };
  const node: Record<string, unknown> = {};
  node.set = (patch: Record<string, unknown>) => {
    state.set.push(patch);
    return node;
  };
  node.where = () => node;
  node.returning = () =>
    Promise.resolve([{ id: "me", name: "Ada", email: "ada@example.com", ...state.set.at(-1) }]);
  return { state, db: { update: () => node } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: async () => ({ id: "me", kind: "human" }),
}));

import { PATCH } from "@/app/api/auth/me/route";
import { Avatar } from "@/components/ui/Avatar";
import { AVATAR_COLORS, PALETTE, ink, pickAvatarColor } from "@/lib/colors";

const GREY = "#8b8f98";

/** What the palette offered before every colour was on offer. */
const OLD = [
  "#6d5bd0",
  "#2f9e7a",
  "#c2557a",
  "#b6763f",
  "#4b8fbe",
  "#3fb0c8",
  "#d1913a",
  "#7a8a2f",
];

function save(color: unknown) {
  const req = new Request("http://localhost/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color }),
  });
  return PATCH(req, undefined);
}

beforeEach(() => {
  fake.state.set = [];
});

describe("the avatar colours", () => {
  it("are the whole palette but the grey, which reads as nobody", () => {
    expect(AVATAR_COLORS).toHaveLength(11);
    expect(AVATAR_COLORS).not.toContain(GREY);
    expect([...AVATAR_COLORS, GREY].sort()).toEqual([...PALETTE].sort());
  });

  it("still hold every colour somebody could save before", () => {
    for (const color of OLD) expect(AVATAR_COLORS).toContain(color);
  });

  it("give a new person or agent one of the eleven", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(pickAvatarColor(`seed-${i}@example.com`));
    expect([...seen].sort()).toEqual([...AVATAR_COLORS].sort());
  });
});

describe("PATCH /api/auth/me", () => {
  it("saves each of the eleven colours", async () => {
    for (const color of AVATAR_COLORS) {
      const res = await save(color.toUpperCase());
      expect(res.status).toBe(200);
      expect(fake.state.set.at(-1)).toEqual({ color });
    }
  });

  it("refuses every other value with 400", async () => {
    for (const color of [GREY, "#000000", "#fff", "red", "", "#6d5bd0ff"]) {
      const res = await save(color);
      expect(res.status).toBe(400);
    }
    expect(fake.state.set).toEqual([]);
  });
});

describe("the initials on an avatar", () => {
  const colourOf = (html: string) => /(?<!-)color:\s*([^;"]+)/.exec(html)?.[1];

  it("take the ink that reads on the light colours", () => {
    for (const color of ["#d1913a", "#3fb0c8", "#2f9e7a", "#7a8a2f"]) {
      expect(ink(color)).toBe("#14161a");
    }
    expect(ink("#6d5bd0")).toBe("#f6f8fa");
  });

  it("wear ink() on every colour, for a person and for an agent's mark", () => {
    for (const color of AVATAR_COLORS) {
      for (const kind of ["human", "agent"] as const) {
        const html = renderToStaticMarkup(
          createElement(Avatar, { name: "Ada Lovelace", color, kind }),
        );
        expect(colourOf(html)).toBe(ink(color));
      }
    }
  });

  it("still draw a colour saved before, in its own colour", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { name: "Ada", color: "#123456" }));
    expect(html).toContain("background:#123456");
    expect(colourOf(html)).toBe(ink("#123456"));
  });
});
