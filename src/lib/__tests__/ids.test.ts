import { describe, expect, it } from "vitest";
import { isId, notAnId } from "../ids";

const ID = "3f8a1c2e-5b6d-4f70-9a1b-2c3d4e5f6a7b";

describe("isId", () => {
  it("takes a UUID", () => {
    expect(isId(ID)).toBe(true);
  });

  /* Postgres reads a UUID in either case and stores the one form, so an id we
     handed out, upper-cased on the way back, still names the same row. */
  it("takes the same UUID in upper case", () => {
    expect(isId(ID.toUpperCase())).toBe(true);
  });

  it("refuses anything that is not one", () => {
    for (const raw of ["not-a-uuid", "", "1234", `${ID}${ID}`]) {
      expect(isId(raw)).toBe(false);
    }
  });

  /* A space is refused rather than trimmed. An id that needs tidying up came
     from somewhere other than this API, and a trim would make two spellings of
     one id both work — until something compares them. */
  it("refuses a UUID with a space around it", () => {
    expect(isId(`${ID} `)).toBe(false);
    expect(isId(` ${ID}`)).toBe(false);
  });

  it("refuses the shapes Postgres would otherwise take", () => {
    expect(isId(`{${ID}}`)).toBe(false);
    expect(isId(ID.replaceAll("-", ""))).toBe(false);
  });

  it("refuses anything that is not text", () => {
    for (const raw of [undefined, null, 7, {}, [ID]]) {
      expect(isId(raw)).toBe(false);
    }
  });
});

describe("notAnId", () => {
  it("names what was asked for", () => {
    expect(notAnId("task")).toBe("That is not a task id.");
    expect(notAnId("run")).toBe("That is not a run id.");
  });
});
