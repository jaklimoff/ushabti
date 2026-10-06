import { describe, expect, it } from "vitest";
import { placeMenu, step, typeAhead, typedWord } from "./select-keys";

const options = [
  { value: "", label: "No select" },
  { value: "s", label: "Status" },
  { value: "p", label: "Priority", disabled: true },
  { value: "t", label: "Type" },
  { value: "z", label: "Size" },
];

describe("step", () => {
  it("moves down and skips a disabled option", () => {
    expect(step(options, 1, 1)).toBe(3);
  });

  it("moves up and skips a disabled option", () => {
    expect(step(options, 3, -1)).toBe(1);
  });

  it("stops at either end rather than wrapping", () => {
    expect(step(options, 4, 1)).toBe(4);
    expect(step(options, 0, -1)).toBe(0);
  });

  it("goes to the first and the last enabled option", () => {
    expect(step(options, 3, "first")).toBe(0);
    expect(step(options, 0, "last")).toBe(4);
    expect(step([{ value: "a", label: "A", disabled: true }, ...options], 3, "first")).toBe(1);
  });
});

describe("typedWord", () => {
  const key = (k: string, more: Partial<KeyboardEvent> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...more,
  });

  it("starts a word with a letter", () => {
    expect(typedWord({ word: "", at: 0 }, key("n"), 5000)).toBe("n");
  });

  it("adds a letter typed soon after the last one", () => {
    expect(typedWord({ word: "n", at: 1000 }, key("o"), 1500)).toBe("no");
  });

  it("starts again after a pause", () => {
    expect(typedWord({ word: "no", at: 1000 }, key("s"), 2000)).toBe("s");
  });

  it("keeps a space inside a word, so a label of two words can be typed", () => {
    expect(typedWord({ word: "no", at: 1000 }, key(" "), 1200)).toBe("no ");
  });

  it("leaves a space that starts no word to open or pick", () => {
    expect(typedWord({ word: "", at: 0 }, key(" "), 5000)).toBeNull();
    expect(typedWord({ word: "no", at: 1000 }, key(" "), 2000)).toBeNull();
  });

  it("leaves a key with a modifier and a named key alone", () => {
    expect(typedWord({ word: "", at: 0 }, key("a", { metaKey: true }), 5000)).toBeNull();
    expect(typedWord({ word: "", at: 0 }, key("Enter"), 5000)).toBeNull();
  });
});

describe("typeAhead", () => {
  it("jumps to the first option that starts with the letter", () => {
    expect(typeAhead(options, 0, "t")).toBe(3);
  });

  it("ignores case", () => {
    expect(typeAhead(options, 0, "T")).toBe(3);
  });

  it("goes past the current option, so a second press finds the next one", () => {
    expect(typeAhead(options, 0, "s")).toBe(1);
    expect(typeAhead(options, 1, "s")).toBe(4);
    expect(typeAhead(options, 4, "s")).toBe(1);
  });

  it("reads a longer word from the current option", () => {
    expect(typeAhead(options, 1, "st")).toBe(1);
    expect(typeAhead(options, 1, "si")).toBe(4);
  });

  it("never lands on a disabled option", () => {
    expect(typeAhead(options, 0, "p")).toBe(-1);
  });

  it("answers -1 when nothing matches", () => {
    expect(typeAhead(options, 0, "q")).toBe(-1);
  });
});

describe("placeMenu", () => {
  it("opens below when the menu fits under the button", () => {
    expect(
      placeMenu(
        { top: 100, bottom: 128, left: 40, width: 140 },
        { height: 200, width: 140 },
        {
          height: 800,
          width: 1200,
        },
      ),
    ).toEqual({ top: 132, left: 40, maxHeight: 260 });
  });

  it("opens above when the bottom of the window would cut it off", () => {
    expect(
      placeMenu(
        { top: 700, bottom: 728, left: 40, width: 140 },
        { height: 200, width: 140 },
        {
          height: 800,
          width: 1200,
        },
      ),
    ).toEqual({ bottom: 104, left: 40, maxHeight: 260 });
  });

  it("scrolls inside the space it has when neither side holds it whole", () => {
    const at = placeMenu(
      { top: 150, bottom: 178, left: 40, width: 140 },
      { height: 600, width: 140 },
      {
        height: 400,
        width: 1200,
      },
    );
    expect(at).toEqual({ top: 182, left: 40, maxHeight: 210 });
  });

  it("moves left rather than leave the window on the right", () => {
    const at = placeMenu(
      { top: 100, bottom: 128, left: 1100, width: 140 },
      { height: 100, width: 200 },
      {
        height: 800,
        width: 1200,
      },
    );
    expect(at.left).toBe(992);
  });
});
