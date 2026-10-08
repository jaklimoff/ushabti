import { describe, expect, it } from "vitest";
import { personMenu, personOpeningAt } from "../people";
import type { MemberDTO } from "../types";

function member(id: string, name: string, kind: MemberDTO["kind"] = "human"): MemberDTO {
  return {
    id,
    name,
    email: null,
    color: "#fff",
    emoji: null,
    role: "member",
    kind,
  } as MemberDTO;
}

// The server sends members in name order, agents among them.
const MEMBERS = [
  member("a", "Ada"),
  member("b", "Bob"),
  member("c", "Claude", "agent"),
  member("m", "Mia"),
  member("r", "Rob"),
];

const names = (me: string | null, draft: string) =>
  personMenu(MEMBERS, me, draft).map((m) => m.name);

describe("personMenu", () => {
  it("puts the reader first, then everyone else by name, agents among them", () => {
    expect(names("m", "")).toEqual(["Mia", "Ada", "Bob", "Claude", "Rob"]);
  });

  it("keeps the order it was given when the reader is not a member", () => {
    expect(names("x", "")).toEqual(["Ada", "Bob", "Claude", "Mia", "Rob"]);
    expect(names(null, "")).toEqual(["Ada", "Bob", "Claude", "Mia", "Rob"]);
  });

  it("narrows by any part of a name, whatever the case", () => {
    expect(names("m", "ob")).toEqual(["Bob", "Rob"]);
    expect(names("m", " CLA ")).toEqual(["Claude"]);
    expect(names("m", "zz")).toEqual([]);
  });

  it("puts the exact name first, then the reader", () => {
    const team = [member("a", "Rob"), member("b", "Robin"), member("m", "Roberta")];
    expect(personMenu(team, "m", "rob").map((m) => m.name)).toEqual(["Rob", "Roberta", "Robin"]);
  });
});

describe("personOpeningAt", () => {
  const rows = personMenu(MEMBERS, "m", "");

  it("opens on the reader when the field is empty", () => {
    expect(personOpeningAt(rows, null, "m")).toBe(1);
  });

  it("opens on the person the field names", () => {
    expect(personOpeningAt(rows, "c", "m")).toBe(4);
  });

  it("opens on the reader when the field names somebody who left", () => {
    expect(personOpeningAt(rows, "gone", "m")).toBe(1);
  });

  it("opens on the empty row when the reader is not offered", () => {
    expect(personOpeningAt(personMenu(MEMBERS, "x", ""), null, "x")).toBe(0);
  });
});
