import { describe, expect, it } from "vitest";
import { canManage, isOwner, outranks, roleChangeRefusal, rolesOffered } from "../roles";

const change = (
  actor: string,
  target: string,
  next: string,
  opts: { kind?: "human" | "agent"; self?: boolean } = {},
) =>
  roleChangeRefusal({
    actor,
    target,
    next,
    targetKind: opts.kind ?? "human",
    self: opts.self ?? false,
  });

describe("roles", () => {
  it("lets the owner and an admin manage, and nobody else", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("admin")).toBe(true);
    expect(canManage("member")).toBe(false);
    expect(canManage("superuser")).toBe(false);
    expect(isOwner("admin")).toBe(false);
  });

  it("acts only from above, so two admins cannot take each other out", () => {
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("admin", "member")).toBe(true);
    expect(outranks("admin", "admin")).toBe(false);
    expect(outranks("admin", "owner")).toBe(false);
    expect(outranks("member", "member")).toBe(false);
  });

  it("lets an admin make a member an admin, and not undo another admin", () => {
    expect(change("admin", "member", "admin")).toBeNull();
    expect(change("admin", "admin", "member")?.status).toBe(403);
    expect(change("owner", "admin", "member")).toBeNull();
  });

  it("keeps the hand-over the owner's", () => {
    expect(change("owner", "member", "owner")).toBeNull();
    expect(change("owner", "admin", "owner")).toBeNull();
    expect(change("admin", "member", "owner")?.status).toBe(403);
    expect(change("admin", "owner", "member")?.status).toBe(403);
  });

  it("refuses a member, an agent, your own row and a word that is no role", () => {
    expect(change("member", "member", "admin")?.status).toBe(403);
    expect(change("owner", "member", "admin", { kind: "agent" })?.status).toBe(400);
    expect(change("owner", "owner", "admin", { self: true })?.status).toBe(400);
    expect(change("admin", "admin", "member", { self: true })?.status).toBe(400);
    expect(change("owner", "member", "viewer")?.status).toBe(400);
  });

  it("offers a select only where it can change something", () => {
    expect(rolesOffered("owner", "member", "human", false)).toEqual(["owner", "admin", "member"]);
    expect(rolesOffered("admin", "member", "human", false)).toEqual(["admin", "member"]);
    expect(rolesOffered("admin", "admin", "human", false)).toEqual([]);
    expect(rolesOffered("owner", "owner", "human", true)).toEqual([]);
    expect(rolesOffered("owner", "member", "agent", false)).toEqual([]);
    expect(rolesOffered("member", "member", "human", false)).toEqual([]);
  });
});
