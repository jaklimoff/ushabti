import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { HttpError, requireUser } from "@/lib/auth";
import { body, json, route, str } from "@/lib/api";
import { AVATAR_COLORS } from "@/lib/colors";
import { isOneEmoji } from "@/lib/emoji";

/**
 * Your own name, colour and face. The first two used to be written once at
 * registration and never again, so a typo in either was permanent and an
 * avatar colour that clashed with a teammate's stayed clashed. The face is an
 * emoji or null, and null is the initials.
 */
export const PATCH = route(async (req: Request) => {
  const user = await requireUser();

  const input = await body<{ name?: string; color?: string; emoji?: unknown }>(req);
  const patch: { name?: string; color?: string; avatarEmoji?: string | null } = {};

  if (input.name !== undefined) patch.name = str(input.name, "Name", { max: 80 });

  if (input.color !== undefined) {
    const color = str(input.color, "Colour", { max: 7 }).toLowerCase();
    // The palette is the palette. A free colour picker is how the board ends
    // up with a person nobody can see against the background.
    if (!AVATAR_COLORS.includes(color)) {
      throw new HttpError(400, "Pick one of the colours on offer.");
    }
    patch.color = color;
  }

  if (input.emoji !== undefined) {
    // The grid offers about thirty, but any one emoji is a face. Two are a
    // word, and a letter is what the initials already are.
    if (input.emoji !== null && (typeof input.emoji !== "string" || !isOneEmoji(input.emoji))) {
      throw new HttpError(400, "A face is one emoji, or null for your initials.");
    }
    patch.avatarEmoji = input.emoji;
  }

  if (Object.keys(patch).length === 0) return json({ ok: true });

  const [row] = await db.update(users).set(patch).where(eq(users.id, user.id)).returning({
    id: users.id,
    name: users.name,
    color: users.color,
    emoji: users.avatarEmoji,
    email: users.email,
  });

  return json({ user: { ...row, email: row.email ?? "" } });
});
