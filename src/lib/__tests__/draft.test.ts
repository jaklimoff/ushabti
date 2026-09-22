import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commentDraftKey,
  draftOf,
  noDraft,
  subscribeDraft,
  sweepDrafts,
  writeDraft,
} from "../draft";

/** A browser that keeps what it is given. */
function aBrowser(): Map<string, string> {
  const store = new Map<string, string>();
  putWindow({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    /* A sweep walks the keys, so the fake counts and names them as a real
       browser does, in the order they were written. */
    get length() {
      return store.size;
    },
    key: (at: number) => [...store.keys()][at] ?? null,
  });
  return store;
}

/** A browser that refuses site data, as a private window does. */
function aClosedBrowser(): void {
  const no = () => {
    throw new Error("The browser refuses site data.");
  };
  putWindow({
    getItem: no,
    setItem: no,
    removeItem: no,
    key: no,
    get length(): number {
      throw new Error("The browser refuses site data.");
    },
  });
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
  it("names the composer, the project and the task it answers", () => {
    expect(commentDraftKey("p-1", "t-1")).toBe("ushabti:draft:comment:p-1:t-1");
    expect(commentDraftKey("p-1", "t-1")).not.toBe(commentDraftKey("p-1", "t-2"));
    /* One browser holds every project, and one board answers for its own. */
    expect(commentDraftKey("p-1", "t-1")).not.toBe(commentDraftKey("p-2", "t-1"));
  });
});

describe("keeping what was typed", () => {
  it("puts the words in the browser", () => {
    const browser = aBrowser();
    const key = commentDraftKey("p-1", "keep-1");
    writeDraft(key, "The queue drops a message.");
    expect(browser.get(key)).toBe("The queue drops a message.");
    expect(draftOf(key)).toBe("The queue drops a message.");
    writeDraft(key, "");
  });

  /* A page that never typed these words reads them back: that is the closed
     tab, and the point of the whole thing. */
  it("reads back words an earlier page left behind", () => {
    const browser = aBrowser();
    const key = commentDraftKey("p-1", "keep-2");
    browser.set(key, "Words from before the tab closed.");
    expect(draftOf(key)).toBe("Words from before the tab closed.");
  });

  it("answers nothing for a composer nobody has typed in", () => {
    aBrowser();
    expect(draftOf(commentDraftKey("p-1", "keep-3"))).toBe("");
    expect(noDraft()).toBe("");
  });
});

describe("throwing a draft away", () => {
  /* Sending the comment and emptying the box by hand are the same write. */
  it("forgets the words when the box is empty", () => {
    const browser = aBrowser();
    const key = commentDraftKey("p-1", "clear-1");
    writeDraft(key, "A note on its way.");
    writeDraft(key, "");
    expect(browser.has(key)).toBe(false);
    expect(draftOf(key)).toBe("");
  });

  it("leaves another composer's draft alone", () => {
    aBrowser();
    const mine = commentDraftKey("p-1", "clear-2");
    const theirs = commentDraftKey("p-1", "clear-3");
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
    const key = commentDraftKey("p-1", "tell-1");
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
    const key = commentDraftKey("p-1", "closed-1");
    expect(() => writeDraft(key, "Typed in a private window.")).not.toThrow();
    expect(draftOf(key)).toBe("Typed in a private window.");
    writeDraft(key, "");
    expect(draftOf(key)).toBe("");
  });
});

describe("sweeping the notes nothing can reach", () => {
  it("keeps a task the board holds and drops the rest", () => {
    const browser = aBrowser();
    const live = commentDraftKey("p-1", "sweep-live");
    const archived = commentDraftKey("p-1", "sweep-archived");
    const orphan = commentDraftKey("p-1", "sweep-gone");
    const blank = commentDraftKey("p-1", "sweep-blank");
    const elsewhere = commentDraftKey("p-2", "sweep-theirs");
    browser.set(live, "Half a note.");
    browser.set(archived, "A note on a task that is over.");
    browser.set(orphan, "A note on a task deleted for good.");
    browser.set(blank, "   \n  ");
    browser.set(elsewhere, "Another project's note.");

    sweepDrafts("p-1", ["sweep-live", "sweep-archived", "sweep-blank"]);

    /* The orphan and the whitespace one go. The other project is not this
       board's to answer for, whatever its tasks are called. */
    expect([...browser.keys()]).toEqual([live, archived, elsewhere]);
  });

  /* A draft written before the key named a project. Nothing can say whose it
     is, so no board would ever answer for it and it would sit there for good. */
  it("takes a key from before the project was in one", () => {
    const browser = aBrowser();
    const old = "ushabti:draft:comment:t-from-before";
    browser.set(old, "A note from an older version.");

    sweepDrafts("p-1", ["t-from-before"]);

    expect(browser.has(old)).toBe(false);
  });

  /* A box open on a draft goes on showing what is in it: the sweep takes back
     what a later tab would read, and nothing under the person's hands. */
  it("leaves what this page is holding", () => {
    const browser = aBrowser();
    const key = commentDraftKey("p-1", "sweep-open");
    writeDraft(key, " ");
    sweepDrafts("p-1", ["sweep-open"]);
    expect(browser.has(key)).toBe(false);
    expect(draftOf(key)).toBe(" ");
    writeDraft(key, "");
  });

  it("says nothing when the browser refuses site data", () => {
    aClosedBrowser();
    expect(() => sweepDrafts("p-1", ["sweep-closed"])).not.toThrow();
  });
});
