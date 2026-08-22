import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, HttpError, verifyPassword } from "@/lib/auth";
import { body, json, route } from "@/lib/api";

export const POST = route(async (req: Request) => {
  const input = await body<{ email?: string; password?: string }>(req);
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) throw new HttpError(401, "Wrong email or password.");

  await createSession(user.id);
  return json({ user: { id: user.id, email, name: user.name, color: user.color } });
});
