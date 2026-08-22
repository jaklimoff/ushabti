import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, sessions, users } from "@/db/schema";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_COOKIE = "ushabti_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

export async function createSession(userId: string): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id, userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await db.delete(sessions).where(eq(sessions.id, id));
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  color: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      color: users.color,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return rows[0] ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Sign in first.");
  return user;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Membership = {
  projectId: string;
  projectName: string;
  projectKey: string;
  ownerId: string;
  role: string;
};

/** Throws unless the user is a member of the project. */
export async function requireMembership(userId: string, projectId: string): Promise<Membership> {
  const rows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectKey: projects.key,
      ownerId: projects.ownerId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new HttpError(404, "Project not found.");
  return row;
}
