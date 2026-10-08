import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { newProject, renderWithBoard, type Answer, type Sent } from "@/test/board";
import { ProjectPanel } from "./ProjectPanel";

/*
 * The Agent rules box of Settings -> Project: what it counts and what it
 * sends. Each test here was a test of `e2e/agent-rules.spec.ts`. Who may write
 * the rules, and that a claim carries them, are the route tests' half.
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
