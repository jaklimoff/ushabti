import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AgentDTO, BoardData } from "@/lib/types";
import { newProject, renderWithBoard, type Answer, type Sent } from "@/test/board";
import { PeoplePanel } from "./PeoplePanel";

/*
 * What the Agents part of Settings -> People draws, and what a press sends.
 * Each test here was a test of `e2e/agents.spec.ts`, `e2e/agent-face.spec.ts`
 * or `e2e/agent-rename.spec.ts`. Who may make each change, and what the server
 * keeps, are the route tests' half.
 */

const AGENT = /^\/api\/projects\/[0-9a-f-]+\/agents\/[0-9a-f-]+$/;
const TOKEN = /^\/api\/agent-tokens\/[0-9a-f-]+$/;
const TOKENS = /^\/api\/projects\/[0-9a-f-]+\/agents\/[0-9a-f-]+\/tokens$/;

let made = 0;
/** A uuid apart from the board's own, because a route reads every id as one. */
function uuid(): string {
  made += 1;
  return `00000000-0000-4000-9000-${String(made).padStart(12, "0")}`;
}

function agent(name: string, color = "#e0574d"): AgentDTO {
  return {
    id: uuid(),
    name,
    color,
    emoji: null,
    createdAt: new Date().toISOString(),
    tokens: [],
  };
}

/*
 * The agents route as the page sees it: the list is read again after every
 * write, so the fake keeps the list and changes it as the server would.
 */
function agentsRoute(agents: AgentDTO[]): Answer {
  return ({ method, path, body }) => {
    if (method === "GET" && /\/agents$/.test(path)) return { body: { agents } };
    if (method === "POST" && TOKENS.test(path)) {
      const owner = agents.find((a) => path.includes(a.id))!;
      const id = uuid();
      owner.tokens = [
        ...owner.tokens,
        {
          id,
          name: (body as { name: string }).name,
          prefix: `ush_${id.slice(-6)}`,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          listeningAt: null,
        },
      ];
      return { body: { token: { id }, secret: `ush_${id.slice(-6)}secret` } };
    }
    if (method === "DELETE" && TOKEN.test(path)) {
      for (const a of agents) a.tokens = a.tokens.filter((t) => !path.endsWith(t.id));
      return { body: {} };
    }
    if (method === "PATCH" && AGENT.test(path)) {
      const i = agents.findIndex((a) => path.endsWith(a.id));
      agents[i] = { ...agents[i], ...(body as Partial<AgentDTO>) };
      return { body: { agent: agents[i] } };
    }
  };
}

async function draw(agents: AgentDTO[], data: BoardData = newProject()) {
  const drawn = await renderWithBoard(<PeoplePanel mail={false} />, data, agentsRoute(agents));
  return { ...drawn, patches: () => drawn.sent("PATCH", AGENT) };
}

const box = (name: string) => page.getByTestId("agent-box").filter({ hasText: name });

/** Waits until `count` writes of a kind have gone out. */
async function wrote(writes: () => Sent[], count: number) {
  await expect.poll(() => writes().length).toBe(count);
}

/** The local day, as the panel names a new token. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

describe("Agents in Settings -> People", () => {
  // Was e2e/agents.spec.ts, the whole test.
  test("an agent's tokens can be told apart, and revoking one says what is left", async () => {
    const { sent } = await draw([agent("Twin")]);
    const twin = box("Twin");
    const rows = twin.getByTestId("token-row");

    // The name is today's date unless somebody says otherwise.
    await twin.getByRole("button", { name: "Connect" }).click();
    const name = twin.getByLabelText("Name of the new token for Twin");
    await expect.element(name).toHaveValue(today());
    await twin.getByRole("button", { name: "Make token" }).click();
    await expect.poll(() => rows.all().length).toBe(1);
    await expect.element(rows.first()).toMatchTextContent(today());
    await expect.element(rows.first()).toMatchTextContent(/ush_\S+…/);
    await expect.element(rows.first()).toMatchTextContent("made today");
    await expect.element(rows.first()).toMatchTextContent("never used");
    await expect.element(name).not.toBeInTheDocument();
    expect(sent("POST", TOKENS)[0].body).toEqual({ name: today() });

    await twin.getByRole("button", { name: "Connect" }).click();
    await name.fill("Laptop");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => rows.all().length).toBe(2);
    expect(sent("POST", TOKENS)[1].body).toEqual({ name: "Laptop" });
    await expect.element(rows.nth(1)).toMatchTextContent("Laptop");
    await expect.element(rows.nth(1)).toMatchTextContent("made today");

    await rows
      .nth(1)
      .getByRole("button", { name: /^Revoke the token/ })
      .click();
    await expect
      .element(page.getByRole("alertdialog"))
      .toMatchTextContent(/Revoke the token “Laptop”\? Twin keeps working on its other token\./);
    await page.getByRole("button", { name: "Yes, revoke" }).click();
    await wrote(() => sent("DELETE", TOKEN), 1);
    await expect.poll(() => rows.all().length).toBe(1);
    await expect.element(rows.first()).toMatchTextContent(today());

    await rows
      .first()
      .getByRole("button", { name: /^Revoke the token/ })
      .click();
    await expect
      .element(page.getByRole("alertdialog"))
      .toMatchTextContent(
        new RegExp(`Revoke the token “${today()}”\\? Twin stops working within one request\\.`),
      );
    await page.getByRole("button", { name: "Yes, revoke" }).click();
    await wrote(() => sent("DELETE", TOKEN), 2);
    await expect.poll(() => rows.all().length).toBe(0);
  });

  // Was e2e/agent-face.spec.ts. The reload at its end is the PATCH body here.
  test("an owner types any one emoji for an agent, and other text saves nothing", async () => {
    const { patches } = await draw([agent("Typist")]);
    const typist = box("Typist");
    await typist.getByRole("button", { name: "Face of Typist" }).click();
    const emojis = typist.getByRole("radiogroup", { name: "Emoji of Typist" });
    const field = typist.getByRole("textbox", { name: "Or type any emoji" });

    for (const text of ["🦊🦊", "ok", "🏿"]) {
      await field.fill(text);
      await expect.element(typist.getByText("One emoji only.")).toBeVisible();
    }
    expect(patches()).toHaveLength(0);

    await field.fill("🤖");
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ emoji: "🤖" });
    await expect.element(field).toHaveValue("");
    await expect.element(typist.getByText("One emoji only.")).not.toBeInTheDocument();
    await expect
      .element(emojis.getByRole("radio", { name: "Face 🤖" }))
      .toHaveAttribute("aria-checked", "true");
  });

  /* The screen half of e2e/agent-face.spec.ts "an owner changes an agent's
     colour and emoji, a member cannot, and another board follows". The other
     board following needs the stream, and the 403 is the route's. */
  test("an owner changes an agent's colour and emoji", async () => {
    const { patches } = await draw([agent("Painter", "#e0574d")]);
    const painter = box("Painter");
    await painter.getByRole("button", { name: "Face of Painter" }).click();

    const colours = painter.getByRole("radiogroup", { name: "Colour of Painter" });
    await expect.poll(() => colours.getByRole("radio").all().length).toBe(11);
    const green = colours.getByRole("radio", { name: "Colour #2f9e7a" });
    await green.click();
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ color: "#2f9e7a" });
    await expect.element(green).toHaveAttribute("aria-checked", "true");

    const emojis = painter.getByRole("radiogroup", { name: "Emoji of Painter" });
    const fox = emojis.getByRole("radio", { name: "Face 🦊" });
    await expect.element(painter.getByTestId("agent-badge")).not.toBeInTheDocument();
    await fox.click();
    await wrote(patches, 2);
    expect(patches()[1].body).toEqual({ emoji: "🦊" });
    await expect.element(painter.getByTestId("agent-badge").first()).toBeInTheDocument();
    await expect.element(fox).toHaveAttribute("aria-checked", "true");
    // The swatch's fill and ring end at one edge, as the avatar's do.
    expect(getComputedStyle(fox.element()).backgroundClip).toBe("padding-box");

    // No emoji gives the ◆ back, and the badge goes with it.
    await emojis.getByRole("radio", { name: "No emoji" }).click();
    await wrote(patches, 3);
    expect(patches()[2].body).toEqual({ emoji: null });
    await expect.element(painter.getByTestId("agent-badge")).not.toBeInTheDocument();
  });

  // The member's half of the same e2e test: the agent is drawn, its face is not offered.
  test("a member sees an agent and cannot change its face", async () => {
    const data = newProject();
    data.project.role = "member";
    await draw([agent("Painter")], data);

    await expect.element(box("Painter")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Face of Painter" }))
      .not.toBeInTheDocument();
  });

  /* The screen half of e2e/agent-rename.spec.ts "an admin renames an agent,
     its history shows the new name, and a name is one agent's". The history
     and the clashes are the board read and the route. */
  test("an admin renames an agent, and the field saves on blur", async () => {
    const { patches } = await draw([agent("Scout")]);
    await box("Scout").getByRole("button", { name: "Face of Scout" }).click();
    const field = page.getByRole("textbox", { name: "Name of the agent Scout" });
    await field.fill("  Ranger ");
    expect(patches()).toHaveLength(0);

    (field.element() as HTMLInputElement).blur();
    await wrote(patches, 1);
    // The box sends what a person meant, not the spaces around it.
    expect(patches()[0].body).toEqual({ name: "Ranger" });
    await expect.element(box("Ranger")).toBeVisible();
  });

  // The last part of the same e2e test.
  test("a name typed and left without a blur still saves", async () => {
    const { patches } = await draw([agent("Ranger")]);
    await box("Ranger").getByRole("button", { name: "Face of Ranger" }).click();
    await page.getByRole("textbox", { name: "Name of the agent Ranger" }).fill("Pathfinder");

    // The box still has the focus. A closed tab raises pagehide and no blur.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ name: "Pathfinder" });
    // Only a keepalive request outlives the page that sent it.
    const leave = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(leave?.[1]?.keepalive).toBe(true);
  });
});
