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
import { Chip } from "@/components/board/Chip";
import { FaceSwatches } from "@/components/ui/Form";
import { AVATAR_COLORS, PALETTE, emojiGround, ink, pickAvatarColor } from "@/lib/colors";

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

  /* #d1913a is a near tie (Lc 50.9 dark, 52.3 light). The PO chose pure APCA
     over a tie-break on 2026-10-01, so it takes light ink with the rest. */
  it("take dark ink on cyan alone and light ink on the other eleven", () => {
    for (const color of PALETTE) {
      expect(ink(color), color).toBe(color === "#3fb0c8" ? "#14161a" : "#f6f8fa");
    }
  });

  it("answer any colour, long or short", () => {
    expect(ink("#ffffff")).toBe("#14161a");
    expect(ink("#fff")).toBe("#14161a");
    expect(ink("#000000")).toBe("#f6f8fa");
    expect(ink("#000")).toBe("#f6f8fa");
    expect(ink("#ffee00")).toBe("#14161a");
    expect(ink("#123456")).toBe("#f6f8fa");
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

describe("an emoji on an avatar", () => {
  const draw = (props: Parameters<typeof Avatar>[0]) =>
    renderToStaticMarkup(createElement(Avatar, props));
  const faceOf = (html: string) => /<span[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";

  it("sits on a dark tint of the colour, inside a ring of the full colour", () => {
    for (const color of AVATAR_COLORS) {
      const face = faceOf(draw({ name: "Ada", color, emoji: "🐸" }));
      expect(face).toContain(`background:${emojiGround(color)}`);
      expect(face).toContain(`box-shadow:inset 0 0 0 1px ${color}`);
    }
  });

  it("leaves the initials and the ◆ on the full colour, with no ring", () => {
    for (const kind of ["human", "agent"] as const) {
      const face = faceOf(draw({ name: "Ada Lovelace", color: "#4f8a5b", kind }));
      expect(face).toContain("background:#4f8a5b");
      expect(face).not.toContain("box-shadow");
    }
  });

  it("keeps the agent badge on the full colour", () => {
    const html = draw({ name: "Builder", color: "#e0574d", emoji: "🔥", kind: "agent" });
    expect(html).toMatch(/data-testid="agent-badge"[^>]*background:#e0574d;color:#f6f8fa/);
  });
});

describe("the face swatches", () => {
  const styleOf = (html: string, label: string) =>
    new RegExp(`aria-label="${label}"[^>]*style="([^"]*)"`).exec(html)?.[1] ??
    new RegExp(`style="([^"]*)"[^>]*aria-label="${label}"`).exec(html)?.[1];
  const faceOf = (html: string) => /<span[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";
  const paint = (style = "") =>
    style
      .split(";")
      .map((rule) => rule.replace(/^background-color:/, "background:"))
      .filter((rule) => /^(background|color|box-shadow):/.test(rule))
      .sort();

  it("paint each face as the avatar it would make", () => {
    for (const color of ["#4f8a5b", "#c2557a", "#d1913a"]) {
      const html = renderToStaticMarkup(
        createElement(FaceSwatches, { name: "Ada Lovelace", color, value: null, onPick: () => {} }),
      );
      const avatar = (emoji: string | null) =>
        paint(faceOf(renderToStaticMarkup(createElement(Avatar, { name: "Ada", color, emoji }))));
      expect(paint(styleOf(html, "Face 🐸"))).toEqual(avatar("🐸"));
      expect(paint(styleOf(html, "Initials"))).toEqual(avatar(null));
    }
  });
});

describe("a filled chip", () => {
  it("writes its words in the ink of its colour", () => {
    for (const fill of ["#c2557a", "#3fb0c8"]) {
      const html = renderToStaticMarkup(
        createElement(Chip, {
          chip: {
            key: "p",
            tip: "Priority: High",
            swatch: null,
            fill,
            person: null,
            text: "High",
            boxed: false,
            mono: false,
            bar: null,
            bubble: false,
          },
        }),
      );
      expect(html).toContain(`background:${fill};color:${ink(fill)}`);
    }
    expect(ink("#c2557a")).toBe("#f6f8fa");
  });
});
