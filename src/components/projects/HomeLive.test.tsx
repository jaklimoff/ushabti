import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useRouter } from "next/navigation";
import { ME } from "@/test/board";
import { BURST_MS } from "@/lib/home-live";
import { ProjectList, type ProjectRow } from "./ProjectList";

/*
 * Home follows every project through one stream, and answers a ring by
 * reading itself again: `router.refresh()`, whose answer is the next set of
 * projects the page hands down. These tests ring the stream and hand the
 * answer down themselves.
 */

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ids = ["a", "b", "c"].map((c) => `00000000-0000-4000-8000-00000000000${c}`);
const rows: ProjectRow[] = ["Harbour", "Lighthouse", "Quay"].map((name, i) => ({
  id: ids[i],
  name,
  key: name.slice(0, 3).toUpperCase(),
  color: "#7aa8f0",
  role: "member",
  waiting: 0,
}));

const names = () =>
  page
    .getByTestId("project-card")
    .elements()
    .map((card) => rows.find((r) => card.textContent?.includes(r.name))?.name);

let sources: { url: string; listeners: Map<string, ((e: MessageEvent) => void)[]> }[] = [];
let held: (() => void)[] = [];
let refresh: ReturnType<typeof vi.spyOn>;

function ring(kind = "change") {
  for (const source of sources) {
    for (const fn of source.listeners.get(kind) ?? []) {
      fn(new MessageEvent(kind, { data: JSON.stringify({ projectId: ids[1] }) }));
    }
  }
}

beforeEach(() => {
  sources = [];
  held = [];
  vi.stubGlobal(
    "EventSource",
    class {
      listeners = new Map<string, ((e: MessageEvent) => void)[]>();
      constructor(readonly url: string) {
        sources.push(this);
      }
      addEventListener(kind: string, fn: (e: MessageEvent) => void) {
        this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), fn]);
      }
      close() {}
    },
  );
  /* A write is answered only when the test lets it go. */
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          held.push(() =>
            resolve(
              new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
            ),
          ),
        ),
    ),
  );
  refresh = vi.spyOn(useRouter(), "refresh");
});

afterEach(() => {
  refresh.mockRestore();
  vi.unstubAllGlobals();
});

describe("Home, live", () => {
  test("holds one stream, whatever the number of projects", async () => {
    await render(<ProjectList user={ME} projects={rows} />);
    expect(sources.map((s) => s.url)).toEqual(["/api/home/stream"]);
  });

  test("answers a burst of rings with one read", async () => {
    await render(<ProjectList user={ME} projects={rows} />);
    for (let i = 0; i < 10; i++) ring();
    await pause(BURST_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("reads on ready, so a dropped socket misses nothing", async () => {
    await render(<ProjectList user={ME} projects={rows} />);
    ring("ready");
    await expect.poll(() => refresh.mock.calls.length).toBe(1);
  });

  test("draws what a read brings", async () => {
    const screen = await render(<ProjectList user={ME} projects={rows} />);
    ring();
    await expect.poll(() => refresh.mock.calls.length).toBe(1);
    await screen.rerender(
      <ProjectList user={ME} projects={[{ ...rows[2], name: "Quay" }, rows[0], rows[1]]} />,
    );
    await expect.poll(names).toEqual(["Quay", "Harbour", "Lighthouse"]);
  });

  test("drops a read that crossed a drag, and reads again once the drag is answered", async () => {
    const screen = await render(<ProjectList user={ME} projects={rows} />);
    ring();
    await expect.poll(() => refresh.mock.calls.length).toBe(1);

    const grip = page.getByRole("button", { name: "Move the project Harbour" });
    (grip.element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(grip).toHaveAttribute("aria-pressed", "true");
    await pause(50);
    await userEvent.keyboard("{ArrowRight}");
    await pause(100);
    await userEvent.keyboard(" ");
    await expect.poll(names).toEqual(["Lighthouse", "Harbour", "Quay"]);
    await expect.poll(() => held.length).toBe(1);

    /* The read's answer arrives with the order from before the drag. */
    await screen.rerender(<ProjectList user={ME} projects={[...rows]} />);
    await pause(BURST_MS * 2);
    expect(names()).toEqual(["Lighthouse", "Harbour", "Quay"]);
    expect(refresh).toHaveBeenCalledTimes(1);

    held.shift()!();
    await expect.poll(() => refresh.mock.calls.length).toBe(2);
    await screen.rerender(<ProjectList user={ME} projects={[rows[1], rows[0], rows[2]]} />);
    await expect.poll(names).toEqual(["Lighthouse", "Harbour", "Quay"]);
  });

  test("a hidden tab reads nothing, and reads once when shown", async () => {
    let state: DocumentVisibilityState = "hidden";
    const seen = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    try {
      await render(<ProjectList user={ME} projects={rows} />);
      for (let i = 0; i < 5; i++) ring();
      await pause(BURST_MS * 3);
      expect(refresh).not.toHaveBeenCalled();

      state = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await expect.poll(() => refresh.mock.calls.length).toBe(1);
      await pause(BURST_MS * 2);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      seen.mockRestore();
    }
  });
});
