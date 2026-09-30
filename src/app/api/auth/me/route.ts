import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { body, json, route, str } from "@/lib/api";
import { readFace } from "@/lib/face";

/**
 * Your own name, colour and face. The first two used to be written once at
 * registration and never again, so a typo in either was permanent and an
 * avatar colour that clashed with a teammate's stayed clashed. The face is an
 * emoji or null, and null is the initials.
 */
export const PATCH = route(async (req: Request) => {
  const user = await requireUser();

  const input = await body<{ name?: string; color?: unknown; emoji?: unknown }>(req);
  const patch: { name?: string; color?: string; avatarEmoji?: string | null } = {};

  if (input.name !== undefined) patch.name = str(input.name, "Name", { max: 80 });
  Object.assign(patch, readFace(input, "your initials"));

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
