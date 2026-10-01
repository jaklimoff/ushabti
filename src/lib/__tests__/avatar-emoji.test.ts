import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A person wears one emoji instead of their initials. The route is read as a
 * client reads it; the database remembers what the update set.
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
    Promise.resolve([
      {
        id: "me",
        name: "Ada",
        email: "ada@example.com",
        color: "#6d5bd0",
        emoji: state.set.at(-1)?.avatarEmoji ?? null,
      },
    ]);
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
import { FACE_EMOJI, isOneEmoji } from "@/lib/emoji";

function save(emoji: unknown) {
  const req = new Request("http://localhost/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
  return PATCH(req, undefined);
}

const ONE = {
  plain: "🦊",
  "a skin tone": "👋🏽",
  "a ZWJ sequence": "👩‍💻",
  "a ZWJ sequence with tones": "🧑🏿‍🤝‍🧑🏻",
  "a variation selector": "❤️",
  "a flag": "🇺🇦",
  "a subdivision flag": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "a keycap": "7️⃣",
  "a symbol asked to draw as an emoji": "©️",
  "a hand with a tone and no selector": "☝🏽",
  "a rainbow flag": "🏳️‍🌈",
};

const NOT_ONE = {
  letters: "ab",
  "one letter": "A",
  "two emoji": "🦊🐻",
  "two flags": "🇺🇦🇵🇱",
  "an emoji and a letter": "🦊a",
  "an empty string": "",
  "a space around it": " 🦊",
  "a digit": "7",
  "a text symbol": "©",
  "a trade mark": "™",
  "an arrow": "↔",
  "an unassigned picture": "\u{1FAFF}",
  "a lone regional indicator": "🇺",
  "two regional indicators that are no flag": "🇦🇦",
  "a lone skin tone": "🏽",
  "a digit with a selector": "7️",
};

beforeEach(() => {
  fake.state.set = [];
});

describe("isOneEmoji", () => {
  for (const [what, text] of Object.entries(ONE)) {
    it(`takes ${what}`, () => expect(isOneEmoji(text)).toBe(true));
  }
  for (const [what, text] of Object.entries(NOT_ONE)) {
    it(`refuses ${what}`, () => expect(isOneEmoji(text)).toBe(false));
  }
  it("takes every face on the grid", () => {
    for (const face of FACE_EMOJI) expect(isOneEmoji(face)).toBe(true);
    expect(new Set(FACE_EMOJI).size).toBe(FACE_EMOJI.length);
  });
});

describe("PATCH /api/auth/me with an emoji", () => {
  it("saves one emoji of every shape", async () => {
    for (const text of Object.values(ONE)) {
      const res = await save(text);
      expect(res.status).toBe(200);
      expect(fake.state.set.at(-1)).toEqual({ avatarEmoji: text });
      expect((await res.json()).user.emoji).toBe(text);
    }
  });

  it("clears the face with null", async () => {
    const res = await save(null);
    expect(res.status).toBe(200);
    expect(fake.state.set.at(-1)).toEqual({ avatarEmoji: null });
    expect((await res.json()).user.emoji).toBeNull();
  });

  it("refuses letters, two emoji, an empty string and a number with 400", async () => {
    for (const value of [...Object.values(NOT_ONE), 7, true, ["🦊"]]) {
      const res = await save(value);
      expect(res.status).toBe(400);
    }
    expect(fake.state.set).toEqual([]);
  });
});

describe("an avatar with an emoji", () => {
  it("draws the emoji on a tint of the colour, and keeps the name as the title", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, { name: "Ada Lovelace", color: "#6d5bd0", emoji: "🦊" }),
    );
    expect(html).toContain("🦊");
    expect(html).not.toContain(">AL<");
    expect(html).toContain("background:#2a2848");
    expect(html).toContain("box-shadow:inset 0 0 0 1px #6d5bd0");
    expect(html).toContain('title="Ada Lovelace"');
  });

  it("draws the initials when the emoji is null", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, { name: "Ada Lovelace", color: "#6d5bd0", emoji: null }),
    );
    expect(html).toContain(">AL<");
  });
});
