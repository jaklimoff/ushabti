import { describe, expect, it } from "vitest";
import { editedText, markOf, sendOnLeave, type LeaveSend } from "@/lib/leave";

const send: LeaveSend = { method: "PATCH", url: "/api/tasks/t1", body: { title: "New" } };

describe("editedText", () => {
  it("answers the trimmed words when they are new", () => {
    expect(editedText("  New  ", "Old")).toBe("New");
  });

  it("answers nothing when the box holds what is saved", () => {
    expect(editedText("Old", "Old")).toBeNull();
    expect(editedText(" Old ", "Old")).toBeNull();
  });

  it("answers nothing for an empty box", () => {
    expect(editedText("   ", "Old")).toBeNull();
  });
});

describe("sendOnLeave", () => {
  it("sends the edit once when a page is left", () => {
    const answer = sendOnLeave(send, null);
    expect(answer?.send).toEqual(send);
    expect(answer?.mark).toBe(markOf(send));
  });

  it("sends nothing when the field is saved", () => {
    expect(sendOnLeave(null, null)).toBeNull();
  });

  it("does not send the same edit twice", () => {
    /* `pagehide` and `visibilitychange` both fire for one leave, and the
       second must not repeat a request still in flight. */
    const first = sendOnLeave(send, null);
    expect(first).not.toBeNull();
    expect(sendOnLeave(send, first!.mark)).toBeNull();
  });

  it("sends again when the words changed after a send", () => {
    const first = sendOnLeave(send, null);
    const later: LeaveSend = { ...send, body: { title: "Newer" } };
    expect(sendOnLeave(later, first!.mark)?.send).toEqual(later);
  });

  it("tells two fields of one task apart", () => {
    const title = sendOnLeave(send, null);
    const description: LeaveSend = { ...send, body: { description: "Words" } };
    expect(sendOnLeave(description, title!.mark)).not.toBeNull();
  });
});
