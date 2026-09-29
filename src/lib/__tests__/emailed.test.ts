import { describe, expect, it } from "vitest";
import { emailedLine } from "@/lib/emailed";

describe("emailedLine", () => {
  it("says nothing while mail is off, so the screen is the one from before mail", () => {
    expect(emailedLine(false, false, "a@b.c")).toBeNull();
  });

  it("says where it went", () => {
    expect(emailedLine(true, true, "a@b.c")).toBe("Emailed to a@b.c.");
  });

  it("says a send failed, and points at the link", () => {
    expect(emailedLine(true, false, "a@b.c")).toBe("Could not email a@b.c. Send them this link.");
  });
});
