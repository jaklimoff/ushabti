import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { ME, newProject, renderWithBoard, withTask, type Answer, type Sent } from "@/test/board";
import { FILES_OFF_NOTE } from "@/lib/attachments";
import { BoardShell } from "@/components/board/BoardApp";
import { ProjectPanel } from "./ProjectPanel";
import { SettingsShell } from "./SettingsShell";
import { TypesPanel } from "./TypesPanel";

/*
 * The Agent rules box of Settings -> Project: what it counts and what it
 * sends. Each test here was a test of `e2e/agent-rules.spec.ts`. Who may write
 * the rules, and that a claim carries them, are the route tests' half. The
 * Files and Export rows below name the specs they came from.
 */

const PROJECT = /^\/api\/projects\/[0-9a-f-]+$/;

/* The project route as the page sees it: a saved patch comes back on the next
   read of the board, as it does after a real save. */
function projectRoute(data: ReturnType<typeof newProject>): Answer {
  let project = data.project;
  return ({ method, path, body }) => {
    if (method === "PATCH" && PROJECT.test(path)) {
      project = { ...project, ...(body as object) };
      return { body: { project } };
    }
    if (method === "GET" && path.endsWith("/board")) return { body: { ...data, project } };
  };
}

async function draw() {
  const data = newProject();
  const drawn = await renderWithBoard(<ProjectPanel files={false} />, data, projectRoute(data));
  return { ...drawn, patches: () => drawn.sent("PATCH", PROJECT) };
}

/** Waits until `count` writes of a kind have gone out. */
async function wrote(writes: () => Sent[], count: number) {
  await expect.poll(() => writes().length).toBe(count);
}

const box = () => page.getByLabelText("Agent rules", { exact: true });

describe("Agent rules", () => {
  /* The screen half of "an admin writes them; the claim carries them, and step
     and beat do not". The claim, the step and the beat are route answers. */
  test("an admin writes them, and the field saves on blur", async () => {
    const { patches } = await draw();
    const rules = "Review means the option Done.\nAsk a person before you estimate.";

    await box().fill(rules);
    await expect
      .element(page.getByTestId("agent-rules-count"))
      .toHaveTextContent(`${rules.length} / 2,000 characters`);
    expect(patches()).toHaveLength(0);

    (box().element() as HTMLTextAreaElement).blur();
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ agentRules: rules });

    // One change, one write: a focus and a blur that changed nothing send none.
    (box().element() as HTMLTextAreaElement).focus();
    (box().element() as HTMLTextAreaElement).blur();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(patches()).toHaveLength(1);
  });

  // Was "the rules are saved although the tab was closed on the box".
  test("the rules are saved although the tab was closed on the box", async () => {
    const { patches } = await draw();
    await box().fill("Done means merged.");

    // The box still has the focus. A closed tab raises pagehide and no blur.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ agentRules: "Done means merged." });
    // Only a keepalive request outlives the page that sent it.
    const leave = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(leave?.[1]?.keepalive).toBe(true);
  });
});

/* The native popup cannot be driven, so the list it is drawn from is the
   check. That the browser offers Europe/Berlin for "Berlin" is its own. */
describe("Time zone", () => {
  const zone = () => page.getByLabelText("The time zone this project's day is worked out in");

  test("the box offers the zone names, UTC among them", async () => {
    await draw();
    const input = zone().element() as HTMLInputElement;
    await expect.poll(() => input.list?.options.length ?? 0).toBeGreaterThan(100);
    const names = [...input.list!.options].map((o) => o.value);
    expect(names).toContain("Europe/Berlin");
    expect(names).toContain("UTC");
    expect(names.filter((n) => n.includes("Berlin"))).toEqual(["Europe/Berlin"]);
  });

  test("a typed zone saves once on blur, and a name off the list is still sent", async () => {
    const { patches } = await draw();
    const input = zone().element() as HTMLInputElement;
    await zone().fill("Asia/Kolkata");
    expect(patches()).toHaveLength(0);

    input.blur();
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ timeZone: "Asia/Kolkata" });

    input.focus();
    input.blur();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(patches()).toHaveLength(1);
  });
});

/* Was "Settings says what to set exactly when the attachment routes answer
   503" in `e2e/attachments.spec.ts`. That every route answers 503 with one
   sentence is `attachments-route.test.ts`; the page is told by its server
   whether there is a bucket, and draws the sentence exactly when there is none. */
describe("Files", () => {
  test("Settings says what to set exactly when the attachment routes answer 503", async () => {
    for (const files of [false, true]) {
      const { screen } = await renderWithBoard(<ProjectPanel files={files} />, newProject());
      await expect.element(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
      expect(page.getByText(FILES_OFF_NOTE).elements()).toHaveLength(files ? 0 : 1);
      await screen.unmount();
    }
  });
});

/* The screen half of "an admin downloads the project; a member is not offered
   it and an agent is refused" in `e2e/export.spec.ts`. What the file holds and
   who the route lets in is `export-route.test.ts`. */
describe("Export", () => {
  test("an admin is offered the download, and a member sees no row", async () => {
    const data = newProject();
    data.project = { ...data.project, role: "admin" };
    const admin = await renderWithBoard(<ProjectPanel files={false} />, data);
    const download = page.getByRole("link", { name: "Download" });
    await expect
      .element(download)
      .toHaveAttribute("href", `/api/projects/${data.project.id}/export`);
    await expect.element(download).toHaveAttribute("download");
    await admin.screen.unmount();

    const member = newProject();
    member.project = { ...member.project, role: "member" };
    await renderWithBoard(<ProjectPanel files={false} />, member);
    await expect.element(page.getByLabelText("Project name")).toBeVisible();
    expect(page.getByText("Export", { exact: true }).elements()).toHaveLength(0);
    expect(download.elements()).toHaveLength(0);
  });
});

/* Was "Settings picks the options with ticks" in `e2e/done-when.spec.ts`.
   What the server makes of the list, and what it frees and archives, is
   `release-route.test.ts`. */
describe("Done when", () => {
  test("Settings picks the options with ticks", async () => {
    const data = newProject();
    const status = data.properties.find((p) => p.name === "Status")!;
    status.options.push({
      ...status.options[0],
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Won't do",
      position: "a9999999",
    });
    const id = (name: string) => status.options.find((o) => o.name === name)!.id;
    const { sent } = await renderWithBoard(
      <ProjectPanel files={false} />,
      data,
      projectRoute(data),
    );
    const patches = () => sent("PATCH", PROJECT);

    await page.getByLabelText("The property that says a task is done").click();
    await page.getByRole("option", { name: "Status" }).click();
    const ticks = page.getByRole("group", { name: "The options that say a task is done" });
    const tick = (name: string) => ticks.getByRole("checkbox", { name, exact: true });
    await expect.poll(() => ticks.getByRole("checkbox").elements()).toHaveLength(6);

    await tick("Shipped").click();
    await expect.element(tick("Shipped")).toBeChecked();
    await expect.element(tick("Shipped")).toBeEnabled();
    await tick("Won't do").click();
    await expect.element(tick("Won't do")).toBeChecked();
    await expect.element(tick("Won't do")).toBeEnabled();
    expect(patches().at(-1)!.body).toEqual({
      doneWhen: { propertyId: status.id, optionIds: [id("Shipped"), id("Won't do")] },
    });

    // Taking every tick away leaves archived as the answer.
    await tick("Shipped").click();
    await expect.element(tick("Shipped")).toBeEnabled();
    await tick("Won't do").click();
    await expect.element(tick("Won't do")).not.toBeChecked();
    await expect.element(tick("Won't do")).toBeEnabled();
    expect(patches().at(-1)!.body).toEqual({ doneWhen: null });
  });
});

/* The screen half of two tests of `e2e/changelog.spec.ts`. What the
   changelog holds, for a member, an agent and a stranger, is
   `release-route.test.ts`; one shipped walk stays end to end. */
/** A board with Use releases on, whose release select is Status. */
function releasesOn() {
  const data = newProject();
  const select = data.properties.find((p) => p.type === "select")!;
  return { ...data, project: { ...data.project, releaseBy: select.id } };
}

describe("Changelog", () => {
  afterEach(async () => {
    await page.viewport(1440, 900);
  });

  test("is reached from Project settings on a phone", async () => {
    await page.viewport(390, 844);
    // The bar is full on a phone, so the link is off it.
    const data = releasesOn();
    const board = await renderWithBoard(<BoardShell initialTask={null} />, data);
    await expect.element(page.getByTitle("Project settings")).toBeVisible();
    const off = page.getByTitle("The options that shipped, and their tasks");
    expect(off.elements()).toHaveLength(1);
    await expect.element(off).not.toBeVisible();
    await board.screen.unmount();

    await renderWithBoard(<ProjectPanel files={false} />, data);
    const link = page.getByRole("link", { name: "Changelog", exact: true });
    await expect.element(link).toBeVisible();
    await expect.element(link).toHaveAttribute("href", `/p/${data.project.id}/changelog`);
  });

  test("is private until somebody makes it public", async () => {
    const data = releasesOn();
    const { sent } = await renderWithBoard(
      <ProjectPanel files={false} />,
      data,
      projectRoute(data),
    );
    const patches = () => sent("PATCH", PROJECT);

    // The button is as wide as its words, not as the card.
    const makePublic = page.getByRole("button", { name: "Make it public" });
    await expect.element(makePublic).toBeVisible();
    expect(makePublic.element().getBoundingClientRect().width).toBeLessThan(200);
    await makePublic.click();
    await expect
      .element(page.getByTestId("public-changelog-link"))
      .toHaveTextContent("/changelog/tst");
    expect(patches().at(-1)!.body).toEqual({ publicChangelog: true });

    // And off again is off at once.
    await page.getByRole("button", { name: "Make it private" }).click();
    await expect.element(page.getByTestId("public-changelog-link")).not.toBeInTheDocument();
    expect(patches().at(-1)!.body).toEqual({ publicChangelog: false });
  });

  /* With releases off both pages are not found, so nothing leads to them. */
  test("is offered only while releases are on", async () => {
    const off = newProject();
    const bar = await renderWithBoard(<BoardShell initialTask={null} />, off);
    await expect.element(page.getByTitle("Project settings")).toBeVisible();
    expect(page.getByTitle("The options that shipped, and their tasks").elements()).toHaveLength(0);
    await bar.screen.unmount();

    const on = releasesOn();
    const lit = await renderWithBoard(<BoardShell initialTask={null} />, on);
    await expect
      .element(page.getByTitle("The options that shipped, and their tasks"))
      .toBeVisible();
    await lit.screen.unmount();

    const panel = await renderWithBoard(<ProjectPanel files={false} />, off);
    await expect.element(page.getByRole("link", { name: "Download" })).toBeVisible();
    expect(page.getByRole("link", { name: "Changelog", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Make it public" }).elements()).toHaveLength(0);
    await panel.screen.unmount();

    await renderWithBoard(<ProjectPanel files={false} />, on);
    await expect.element(page.getByRole("link", { name: "Changelog", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Make it public" })).toBeVisible();
  });
});

/* Each test below was a test of `e2e/settings.spec.ts`, and its name is the
   name it had there. */
describe("Settings", () => {
  test("changing the project key warns about the tasks it renames", async () => {
    const data = newProject();
    withTask(data, "Named after the key", { Status: "Todo" });
    await renderWithBoard(<ProjectPanel files={false} />, data);

    await page.getByLabelText("Project key", { exact: true }).fill("ZZZ");
    await expect.element(page.getByText(/1 task is called .*today/)).toBeVisible();
  });

  test("the project delete asks for the key", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<ProjectPanel files={false} />, data);

    await page.getByRole("button", { name: "Delete project" }).click();
    const go = page.getByRole("button", { name: "Delete for good" });
    await expect.element(go).toBeDisabled();

    await page.getByLabelText("Type the project key to confirm").fill(data.project.key);
    await expect.element(go).toBeEnabled();
    expect(sent("DELETE")).toEqual([]);
    await go.click();
    await wrote(() => sent("DELETE", PROJECT), 1);
    expect(sent("DELETE", PROJECT)[0].path).toBe(`/api/projects/${data.project.id}`);
  });
});

/*
 * A field saves on blur, and a tab closed on a focused field sends no blur.
 * The save goes out on the way off the page instead. A closed tab raises
 * pagehide, which is what these tests raise; that the server keeps the zone
 * is the project route's own.
 */
describe("An edit the tab was closed on", () => {
  test("the time zone is saved although nothing was blurred", async () => {
    const { patches } = await draw();
    const zone = page.getByLabelText("The time zone this project's day is worked out in");
    await zone.fill("Europe/Berlin");

    // The box still has the focus. Closing the tab here is the lost edit.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ timeZone: "Europe/Berlin" });
    const leave = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(leave?.[1]?.keepalive).toBe(true);
  });

  test("a zone off the list is still sent on the way off the page", async () => {
    const { patches } = await draw();
    await page
      .getByLabelText("The time zone this project's day is worked out in")
      .fill("Asia/Kolkata");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ timeZone: "Asia/Kolkata" });
  });

  /*
   * A box mirrors what is saved, and the mirror goes stale the moment another
   * tab changes it. Leaving on that mirror would put the old words back, which
   * is not a lost edit being saved but a saved edit being lost.
   */
  test("a tab that typed nothing writes nothing back", async () => {
    const data = newProject();
    const server = structuredClone(data);
    const { sent, ring } = await renderWithBoard(
      <SettingsShell initial={data} user={ME} version="0.0.0">
        <ProjectPanel files={false} />
      </SettingsShell>,
      data,
      ({ method, path }) =>
        method === "GET" && /\/(settings|board)$/.test(path) ? { body: server } : undefined,
    );
    await expect.element(page.getByLabelText("Project name")).toBeVisible();

    // The other tab renames the project, and this one hears about it.
    server.project = { ...server.project, name: "Renamed elsewhere" };
    ring();
    /* The bar of this tab, and not the answer to its read: the tab is still
       holding the name it was born with until the read lands. */
    await expect
      .element(page.getByTestId("project-switcher"))
      .toHaveAccessibleName("Renamed elsewhere");

    // Nobody typed in this tab, so closing it writes nothing.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent("PATCH")).toEqual([]);
  });
});

describe("Settings on a laptop", () => {
  test("the project page groups its cards under headings, the danger zone last", async () => {
    // "Files" shows only on a server with no bucket, so this one has a bucket.
    await renderWithBoard(<ProjectPanel files />, newProject());
    await expect
      .poll(() =>
        page
          .getByRole("heading", { level: 2 })
          .elements()
          .map((h) => h.textContent),
      )
      .toEqual([
        "Name, key and colour",
        "Dates and progress",
        "Agents",
        "Releases and sprints",
        "Sharing and export",
        "Danger zone",
      ]);
  });

  /* "Public changelog" is drawn only while releases are on (USH-226), so the
     page is drawn with them on; the spec had not caught up. */
  test("no inline label breaks onto a second line", async () => {
    const data = releasesOn();
    const project = await renderWithBoard(<ProjectPanel files />, data);
    await expect.element(page.getByLabelText("Project name")).toBeVisible();
    for (const label of [
      "Name",
      "Key",
      "Time zone",
      "Done when",
      "Count progress by",
      "Releases",
      "Sprints",
      "Public changelog",
      "Export",
    ]) {
      expect(linesOf(label), `"${label}" takes ${linesOf(label)} lines`).toBe(1);
    }
    await project.screen.unmount();

    await renderWithBoard(<TypesPanel />, newProject());
    await expect.element(page.getByLabelText("Types come from")).toBeVisible();
    expect(linesOf("Types come from")).toBe(1);
  });
});

/** The lines the words of the one span that reads `label` fill. */
function linesOf(label: string): number {
  const spans = [...document.querySelectorAll("span")].filter(
    (el) => el.childNodes.length === 1 && el.textContent === label,
  );
  expect(spans, `one span reads "${label}"`).toHaveLength(1);
  const range = document.createRange();
  range.selectNodeContents(spans[0].firstChild!);
  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
}

describe("Project colour", () => {
  test("an admin picks a swatch, and it saves at once", async () => {
    const data = newProject();
    data.project.role = "admin";
    const drawn = await renderWithBoard(<ProjectPanel files />, data, projectRoute(data));
    const colours = page.getByRole("radiogroup", { name: "Project colour" });
    await expect
      .element(colours.getByRole("radio", { name: "Colour #7aa8f0" }))
      .toHaveAttribute("aria-checked", "true");

    await colours.getByRole("radio", { name: "Colour #ec8fb8" }).click();
    await wrote(() => drawn.sent("PATCH", PROJECT), 1);
    expect(drawn.sent("PATCH", PROJECT)[0].body).toEqual({ color: "#ec8fb8" });
    await expect
      .element(colours.getByRole("radio", { name: "Colour #ec8fb8" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(colours.getByRole("radio", { name: "Colour #7aa8f0" }))
      .toHaveAttribute("aria-checked", "false");
  });

  test("a member sees the colour and cannot pick one", async () => {
    const data = newProject();
    data.project.role = "member";
    await renderWithBoard(<ProjectPanel files />, data, projectRoute(data));
    await expect.element(page.getByRole("radio", { name: "Colour #ec8fb8" })).toBeDisabled();
  });
});
