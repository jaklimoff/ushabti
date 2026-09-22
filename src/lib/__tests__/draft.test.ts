import { afterEach, describe, expect, it, vi } from "vitest";
import { commentDraftKey, draftOf, noDraft, subscribeDraft, writeDraft } from "../draft";

/** A browser that keeps what it is given. */
function aBrowser(): Map<string, string> {
  const store = new Map<string, string>();
  putWindow({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

/** A browser that refuses site data, as a private window does. */
function aClosedBrowser(): void {
  const no = () => {
    throw new Error("The browser refuses site data.");
  };
  putWindow({ getItem: no, setItem: no, removeItem: no });
}

function putWindow(localStorage: unknown): void {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("where a draft is kept", () => {
  it("names the composer and the task it answers", () => {
    expect(commentDraftKey("t-1")).toBe("ushabti:draft:comment:t-1");
    expect(commentDraftKey("t-1")).not.toBe(commentDraftKey("t-2"));
  });
});

describe("keeping what was typed", () => {
  it("puts the words in the browser", () => {
    const browser = aBrowser();
    const key = commentDraftKey("keep-1");
    writeDraft(key, "The queue drops a message.");
    expect(browser.get(key)).toBe("The queue drops a message.");
    expect(draftOf(key)).toBe("The queue drops a message.");
    writeDraft(key, "");
  });

  /* A page that never typed these words reads them back: that is the closed
     tab, and the point of the whole thing. */
  it("reads back words an earlier page left behind", () => {
    const browser = aBrowser();
    const key = commentDraftKey("keep-2");
    browser.set(key, "Words from before the tab closed.");
    expect(draftOf(key)).toBe("Words from before the tab closed.");
  });

  it("answers nothing for a composer nobody has typed in", () => {
    aBrowser();
    expect(draftOf(commentDraftKey("keep-3"))).toBe("");
    expect(noDraft()).toBe("");
  });
});

describe("throwing a draft away", () => {
  /* Sending the comment and emptying the box by hand are the same write. */
  it("forgets the words when the box is empty", () => {
    const browser = aBrowser();
    const key = commentDraftKey("clear-1");
    writeDraft(key, "A note on its way.");
    writeDraft(key, "");
    expect(browser.has(key)).toBe(false);
    expect(draftOf(key)).toBe("");
  });

  it("leaves another composer's draft alone", () => {
    aBrowser();
    const mine = commentDraftKey("clear-2");
    const theirs = commentDraftKey("clear-3");
    writeDraft(mine, "Mine.");
    writeDraft(theirs, "Theirs.");
    writeDraft(mine, "");
    expect(draftOf(theirs)).toBe("Theirs.");
    writeDraft(theirs, "");
  });
});

describe("telling the composer", () => {
  it("tells every listener, and stops when one goes", () => {
    aBrowser();
    const key = commentDraftKey("tell-1");
    const heard = vi.fn();
    const stop = subscribeDraft(heard);
    writeDraft(key, "One");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    writeDraft(key, "");
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("a browser that refuses site data", () => {
  /* The draft is then lost with the tab, as it is today. What must not happen
     is a box that shows nothing back while somebody types in it. */
  it("still holds the words for as long as the page lives", () => {
    aClosedBrowser();
    const key = commentDraftKey("closed-1");
    expect(() => writeDraft(key, "Typed in a private window.")).not.toThrow();
    expect(draftOf(key)).toBe("Typed in a private window.");
    writeDraft(key, "");
    expect(draftOf(key)).toBe("");
  });
});
