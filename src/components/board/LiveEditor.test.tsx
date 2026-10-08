import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { newProject, renderWithBoard, withAgent, withTask } from "@/test/board";
import { boxValue, fillBox, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The description is a CodeMirror box whose lines read as rendered markdown,
 * except the lines the cursor is on. The words it holds are markdown and
 * nothing else. Each test was a test of `e2e/live-preview.spec.ts`, and its
 * name is the name it had there. Browser Mode has the real layout and the
 * real CSS modules, so the measures are the ones the spec took. The chunk
 * fetched as the panel opens needs the production build, and stays there.
 */

const AGENT = "Night Builder";
const byTestId = (id: string) => page.getByTestId(id);
const editor = () => byTestId("live-editor");
const inBox = (selector: string) => editor().element().querySelectorAll<HTMLElement>(selector);
const markdown = () => byTestId("markdown").element();
const mod = (key: string) => userEvent.keyboard(`{ControlOrMeta>}${key}{/ControlOrMeta}`);

afterEach(async () => {
  await page.viewport(1440, 900);
});

/** A task open in the panel, its description box open and focused. */
async function openDescription(agent = false) {
  const data = newProject();
  if (agent) withAgent(data, AGENT);
  const task = withTask(data, "Write it live", { Status: "Todo" });
  const server = serving(data);
  const drawn = await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);
  await page.getByText("Add a description…").click();
  await expect.element(editor()).toHaveFocus();
  return { ...drawn, ...server, task };
}

/** Saves the box with Mod + Enter and waits for the page to draw it. */
async function saveBox() {
  await mod("{Enter}");
  await expect.element(byTestId("markdown")).toBeVisible();
  await expect.poll(() => editor().elements().length).toBe(0);
}

/** Where an element's words sit, without the padding or the gap of its line. */
function words(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const { top, bottom } = range.getBoundingClientRect();
  return { top, bottom };
}

const CODE_LOOK = [
  "background-color",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

function look(el: Element, names: string[]) {
  const style = getComputedStyle(el);
  return names.map((name) => `${name}: ${style.getPropertyValue(name)}`);
}

/** The first line of the box that holds these words. */
function line(text: string): Element {
  const found = [...inBox(".cm-line")].find((l) => l.textContent?.includes(text));
  if (!found) throw new Error(`No line of the box holds ${text}.`);
  return found;
}

/** The first element of the page's markdown of this tag that holds these words. */
function onPage(tag: string, text: string): Element {
  const found = [...markdown().querySelectorAll(tag)].find((el) => el.textContent?.includes(text));
  if (!found) throw new Error(`No ${tag} of the page holds ${text}.`);
  return found;
}

type Spaces = Record<string, number>;
function closeTo(inTheBox: Spaces, wanted: Spaces) {
  for (const key of Object.keys(wanted))
    expect(Math.abs(inTheBox[key] - wanted[key]), key).toBeLessThanOrEqual(2);
}

describe("The live description", () => {
  test("hides the marks on every line but the cursor's", async () => {
    await openDescription();
    // `[[` is one `[` to the keyboard, which reads `[` as the start of a key's name.
    await userEvent.keyboard("## Plan{Enter}**bold** and ~gone~ and `code`{Enter}- [[ ] open item");
    await userEvent.keyboard("{Enter}{Enter}");

    // The cursor is on the last, empty line, so every line above reads rendered.
    const text = () => editor().element().textContent ?? "";
    await expect.poll(text).toContain("Plan");
    expect(text()).not.toContain("##");
    expect(text()).not.toContain("**");
    expect(text()).not.toContain("~");
    expect(inBox(".cm-lp-strong")[0].textContent).toBe("bold");
    expect(inBox(".cm-lp-strike")[0].textContent).toBe("gone");
    expect(inBox(".cm-lp-code")[0].textContent).toBe("code");

    // A tick writes the words.
    const box = () => inBox(".cm-lp-task")[0] as HTMLInputElement;
    expect(box().checked).toBe(false);
    await userEvent.click(box());
    await expect.poll(() => box().checked).toBe(true);
    expect(boxValue()).toContain("- [x] open item");

    // Back on the heading, its marks come back.
    await mod("{Home}");
    await expect.poll(() => inBox(".cm-line")[0].textContent).toBe("## Plan");

    await saveBox();
    expect(markdown().textContent).toContain("bold and gone and code");
    expect(markdown().querySelector("del")?.textContent).toBe("gone");
    expect(markdown().querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  });

  test("inline code wears the page's box, and its backticks stand beside it", async () => {
    await openDescription();
    await fillBox("see `code` here\n");
    const box = look(inBox(".cm-lp-code")[0], CODE_LOOK);
    await saveBox();
    expect(box).toEqual(look(markdown().querySelector("code")!, CODE_LOOK));

    await page.getByText("here").click();
    await expect.element(editor()).toHaveFocus();
    await mod("{Home}");
    await expect.poll(() => inBox(".cm-line")[0].textContent).toBe("see `code` here");
    expect(inBox(".cm-lp-code")[0].textContent).toBe("code");
  });

  test("paragraphs and a heading keep the page's spaces in the box", async () => {
    await openDescription();
    await fillBox("intro\n\n## Plan\n\n## Steps\n\nfirst\n\n\n\nsecond\n");
    const spaces = (v: Record<string, { top: number; bottom: number }>) => ({
      aboveHeading: v.plan.top - v.intro.bottom,
      betweenHeadings: v.steps.top - v.plan.bottom,
      belowHeading: v.first.top - v.steps.bottom,
      paragraphs: v.second.top - v.first.bottom,
    });
    const box = spaces({
      intro: words(line("intro")),
      plan: words(line("Plan")),
      steps: words(line("Steps")),
      first: words(line("first")),
      second: words(line("second")),
    });
    await saveBox();
    closeTo(
      box,
      spaces({
        intro: words(onPage("p", "intro")),
        plan: words(onPage("h2", "Plan")),
        steps: words(onPage("h2", "Steps")),
        first: words(onPage("p", "first")),
        second: words(onPage("p", "second")),
      }),
    );
  });

  for (const blanks of [2, 3, 4]) {
    test(`two headings with ${blanks} blank lines between them keep the page's space`, async () => {
      await openDescription();
      const gap = "\n".repeat(blanks + 1);
      await fillBox(`intro${gap}## Plan${gap}## Steps${gap}first\n`);
      const spaces = (v: Record<string, { top: number; bottom: number }>) => ({
        aboveHeading: v.plan.top - v.intro.bottom,
        betweenHeadings: v.steps.top - v.plan.bottom,
        belowHeading: v.first.top - v.steps.bottom,
      });
      const box = spaces({
        intro: words(line("intro")),
        plan: words(line("Plan")),
        steps: words(line("Steps")),
        first: words(line("first")),
      });
      await saveBox();
      closeTo(
        box,
        spaces({
          intro: words(onPage("p", "intro")),
          plan: words(onPage("h2", "Plan")),
          steps: words(onPage("h2", "Steps")),
          first: words(onPage("p", "first")),
        }),
      );
    });
  }

  test("a blank line under the cursor is a full line and takes typing", async () => {
    await openDescription();
    await fillBox("one\n\ntwo");
    const height = (n: number) => inBox(".cm-line")[n].getBoundingClientRect().height;
    const full = height(0);
    // Away from it, it is the gap; on it, it is a line again.
    await mod("{End}");
    await expect.poll(() => height(1)).toBeLessThan(full / 2);
    await mod("{Home}");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => height(1)).toBe(full);
    await userEvent.keyboard("between");
    await expect.poll(boxValue).toBe("one\nbetween\ntwo");
  });

  test("a code block keeps the mono font in the box", async () => {
    await openDescription();
    await fillBox("```\nconst a = 1;\n```\n\nafter");
    const font = ["font-family", "font-size"];
    const box = look(inBox(".cm-line.cm-lp-code")[0], font);
    await saveBox();
    expect(box).toEqual(look(markdown().querySelector("pre code")!, font));
  });

  test("a selection across lines shows the marks of every line in it", async () => {
    await openDescription();
    await fillBox("**one**\n**two**\n**three**\n");
    const lines = () => [...inBox(".cm-line")].map((l) => l.textContent);
    await expect.poll(lines).toEqual(["one", "two", "three", ""]);
    await mod("{Home}");
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await expect.poll(lines).toEqual(["**one**", "**two**", "three", ""]);
  });

  test("a key of a known task reads as a link, as the page draws it", async () => {
    const { task } = await openDescription();
    await expect.element(byTestId("task-key")).toHaveTextContent(task.key);
    await fillBox(`Waits on ${task.key} and \`${task.key}\`\n`);
    const link = inBox("[data-task-key]");
    expect(link).toHaveLength(1);
    expect(link[0].textContent).toBe(task.key);
    expect(link[0].classList).toContain("cm-lp-link");
    (editor().element() as HTMLElement).blur();
    await expect
      .poll(() => markdown().querySelector("a[data-task-key]")?.textContent)
      .toBe(task.key);
  });

  test("the @ list works inside it, with the same keys", async () => {
    await openDescription(true);
    const list = () => byTestId("mention-list");
    await userEvent.keyboard("Over to @nig");
    await expect.element(list()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(list()).not.toBeInTheDocument();
    // Escape closed the list and nothing else.
    await expect.element(editor()).toBeVisible();
    await userEvent.keyboard("h{Backspace}");
    await expect.element(list()).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(list()).not.toBeInTheDocument();
    await expect.poll(boxValue).toBe(`Over to @${AGENT} `);
    await userEvent.keyboard("today");
    await expect.poll(boxValue).toBe(`Over to @${AGENT} today`);
    (editor().element() as HTMLElement).blur();
    await expect.element(byTestId("markdown")).toMatchTextContent(`Over to @${AGENT} today`);
  });

  test("Escape throws the edit away and leaves the panel open", async () => {
    const { sent } = await openDescription();
    await userEvent.keyboard("not kept");
    await userEvent.keyboard("{Escape}");
    await expect.element(editor()).not.toBeInTheDocument();
    await expect.element(byTestId("task-title")).toBeVisible();
    await expect.element(page.getByText("Add a description…")).toBeVisible();
    expect(sent("PATCH")).toEqual([]);
  });

  for (const how of ["drop", "paste"] as const) {
    test(`a file handed in by ${how} writes its line at the cursor`, async () => {
      const { task } = await stubbedUploads();
      await fillBox("first line\nlast line");
      // The caret goes to the end of the first line.
      await mod("{Home}");
      await userEvent.keyboard("{End}");

      const files = new DataTransfer();
      files.items.add(new File([new Uint8Array([1, 2, 3])], "pixel.png", { type: "image/png" }));
      const el = editor().element();
      if (how === "drop")
        el.dispatchEvent(
          new DragEvent("drop", { dataTransfer: files, bubbles: true, cancelable: true }),
        );
      else el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: files, bubbles: true }));

      const written = `![pixel.png](/api/attachments/${UPLOAD})`;
      await expect.poll(boxValue).toBe(`first line\n${written}\nlast line`);
      // The caret is after the line, so typing goes on from there.
      await userEvent.keyboard("{Enter}typed after");
      expect(boxValue()).toBe(`first line\n${written}\ntyped after\nlast line`);
      expect(task.id).toBeTruthy();
    });
  }
});

/*
 * The upload routes, answered here: this proves where the box writes the
 * line, which needs no bucket. `upload.spec.ts` runs the real thing where one
 * is set. The file goes to the bucket by `XMLHttpRequest`, which the bucket
 * here takes at once.
 */
const UPLOAD = "00000000-0000-4000-8000-bbbbbbbbbbbb";

class Bucket {
  status = 0;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send() {
    setTimeout(() => {
      this.status = 200;
      this.onload?.();
    }, 10);
  }
}

async function stubbedUploads() {
  vi.stubGlobal("XMLHttpRequest", Bucket);
  const data = newProject();
  const task = withTask(data, "Write it live", { Status: "Todo" });
  const server = serving(data);
  await renderWithBoard(<BoardShell initialTask={task.key} />, data, (sent) => {
    if (sent.method === "POST" && /\/api\/tasks\/[0-9a-f-]+\/attachments$/.test(sent.path))
      return { body: { id: UPLOAD, uploadUrl: "/stub-bucket", headers: {} } };
    if (sent.method === "POST" && sent.path === `/api/attachments/${UPLOAD}/ready`)
      return {
        body: {
          attachment: {
            id: UPLOAD,
            taskId: task.id,
            uploaderId: null,
            name: "pixel.png",
            mime: "image/png",
            size: 70,
            width: 1,
            height: 1,
            createdAt: new Date().toISOString(),
            url: `/api/attachments/${UPLOAD}`,
          },
        },
      };
    return server.answer(sent);
  });
  await page.getByText("Add a description…").click();
  await expect.element(editor()).toHaveFocus();
  return { task };
}

describe("The live description on a phone", () => {
  test("typing scrolls nothing sideways, and the caret stays on the screen", async () => {
    await page.viewport(390, 844);
    await openDescription();
    const long = "https://example.com/" + "a-very-long-path-segment/".repeat(12);
    for (let i = 0; i < 25; i++)
      await userEvent.keyboard(`${i === 3 ? long : `line ${i} of a long description`}{Enter}`);
    await userEvent.keyboard("the end");
    await expect.poll(boxValue).toContain("the end");

    const root = document.documentElement;
    expect(root.scrollWidth - root.clientWidth).toBe(0);
    const caret = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    expect(caret.top).toBeGreaterThanOrEqual(0);
    expect(caret.bottom).toBeLessThanOrEqual(844);
    expect(caret.left).toBeGreaterThanOrEqual(0);
    expect(caret.right).toBeLessThanOrEqual(390);
  });
});
