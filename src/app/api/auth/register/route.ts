import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, HttpError } from "@/lib/auth";
import { body, json, route, str } from "@/lib/api";
import { pickAvatarColor } from "@/lib/colors";

export const POST = route(async (req: Request) => {
  const input = await body<{ email?: string; password?: string; name?: string }>(req);

  const email = str(input.email, "Email", { max: 200 }).toLowerCase();
  const name = str(input.name, "Name", { max: 80 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "That email address does not look correct.");
  }
  if (typeof input.password !== "string" || input.password.length < 8) {
    throw new HttpError(400, "The password must have at least 8 characters.");
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length) throw new HttpError(409, "An account with that email already exists.");

  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: await hashPassword(input.password),
      color: pickAvatarColor(email),
    })
    .returning({ id: users.id, email: users.email, name: users.name, color: users.color });

  await createSession(user.id);
  return json({ user });
});
