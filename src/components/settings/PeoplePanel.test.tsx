import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AgentDTO, BoardData } from "@/lib/types";
import { newProject, renderWithBoard, withPerson, type Answer, type Sent } from "@/test/board";
import { PeoplePanel } from "./PeoplePanel";

/*
 * What Settings -> People draws, and what a press sends. Each test here was a
 * test of `e2e/agents.spec.ts`, `e2e/agent-face.spec.ts`,
 * `e2e/agent-rename.spec.ts` or, for the members, `e2e/roles.spec.ts`. Who may
 * make each change, and what the server keeps, are the route tests' half.
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
    acts: {},
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
      const patch = body as Partial<AgentDTO>;
      agents[i] = {
        ...agents[i],
        ...patch,
        acts: { ...agents[i].acts, ...patch.acts },
      };
      return { body: { agent: agents[i] } };
    }
  };
}

async function draw(agents: AgentDTO[], data: BoardData = newProject()) {
  const drawn = await renderWithBoard(<PeoplePanel mail={false} />, data, agentsRoute(agents));
  return { ...drawn, patches: () => drawn.sent("PATCH", AGENT) };
}

const box = (name: string) => page.getByTestId("agent-box").filter({ hasText: name });

/** An agent starts folded; its whole line is the button that opens it. */
async function unfold(name: string) {
  const head = box(name).getByRole("button", { expanded: false });
  await head.click();
  await expect.element(box(name).getByRole("button", { expanded: true })).toBeVisible();
}

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
  test("each agent is one folded line that says what it may do and whether it hears", async () => {
    const quiet = { ...agent("Quiet"), acts: { ship: false } };
    const heard = agent("Heard");
    heard.tokens = [
      {
        id: uuid(),
        name: "Laptop",
        prefix: "ush_abcdef",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        listeningAt: new Date().toISOString(),
      },
    ];
    await draw([quiet, heard]);

    const quietHead = box("Quiet").getByRole("button", { expanded: false });
    await expect
      .element(quietHead)
      .toMatchTextContent("May everything but delete and ship · no token");
    await expect.element(quietHead).toMatchTextContent("Silent");
    await expect
      .element(box("Heard").getByRole("button", { expanded: false }))
      .toMatchTextContent(/May everything but delete · 1 token.*Listening/);
    // Folded, nothing of the agent's insides is drawn.
    await expect.element(page.getByTestId("agent-may")).not.toBeInTheDocument();
    await expect.element(page.getByTestId("token-row")).not.toBeInTheDocument();

    // Open, it reads May, Tokens, Name, and the foot that removes it.
    await unfold("Quiet");
    const open = box("Quiet");
    const text = open.element().textContent ?? "";
    const order = ["May", "Tokens", "Name", "A switch only takes away", "Remove Quiet"].map(
      (word) => text.indexOf(word, text.indexOf("Silent")),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await open.getByRole("button", { name: "Remove Quiet" }).click();
    await expect.element(page.getByText(/^Remove Quiet\? Its tokens stop working/)).toBeVisible();
  });

  // Was e2e/agents.spec.ts, the whole test.
  test("an agent's tokens can be told apart, and revoking one says what is left", async () => {
    const { sent } = await draw([agent("Twin")]);
    const twin = box("Twin");
    await unfold("Twin");
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

    // Once it has a token, the next one is a new token.
    await twin.getByRole("button", { name: "New token" }).click();
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
    await unfold("Typist");
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
    await unfold("Painter");

    const colours = painter.getByRole("radiogroup", { name: "Colour of Painter" });
    await expect.poll(() => colours.getByRole("radio").all().length).toBe(11);
    const green = colours.getByRole("radio", { name: "Teal" });
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

    await unfold("Painter");
    await expect.element(box("Painter").getByTestId("agent-may")).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Name of the agent Painter" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Remove Painter" }))
      .not.toBeInTheDocument();
  });

  /* The screen half of e2e/agent-rename.spec.ts "an admin renames an agent,
     its history shows the new name, and a name is one agent's". The history
     and the clashes are the board read and the route. */
  test("an admin renames an agent, and the field saves on blur", async () => {
    const { patches } = await draw([agent("Scout")]);
    await unfold("Scout");
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
    await unfold("Ranger");
    await page.getByRole("textbox", { name: "Name of the agent Ranger" }).fill("Pathfinder");

    // The box still has the focus. A closed tab raises pagehide and no blur.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ name: "Pathfinder" });
    // Only a keepalive request outlives the page that sent it.
    const leave = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(leave?.[1]?.keepalive).toBe(true);
  });

  test("an admin switches an act on or off on the May line, and it saves on click", async () => {
    const { patches } = await draw([agent("Keeper")]);
    await unfold("Keeper");
    const may = box("Keeper").getByTestId("agent-may");
    await expect.element(may).toMatchTextContent(/^May/);
    // Delete starts off; the rest start on.
    const del = page.getByRole("checkbox", { name: "Keeper may delete tasks" });
    const create = page.getByRole("checkbox", { name: "Keeper may create tasks" });
    await expect.element(del).not.toBeChecked();
    await expect.element(create).toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: "Keeper may ship releases" }))
      .toBeChecked();

    await del.click();
    await wrote(patches, 1);
    expect(patches()[0].body).toEqual({ acts: { delete: true } });
    await expect.element(del).toBeChecked();

    await create.click();
    await wrote(patches, 2);
    expect(patches()[1].body).toEqual({ acts: { create: false } });
    await expect.element(create).not.toBeChecked();
  });

  test("a member sees what an agent may do and cannot change it", async () => {
    const data = newProject();
    data.project.role = "member";
    await draw([{ ...agent("Keeper"), acts: { archive: false } }], data);
    await unfold("Keeper");
    const archive = page.getByRole("checkbox", { name: "Keeper may archive tasks" });
    await expect.element(archive).not.toBeChecked();
    await expect.element(archive).toBeDisabled();
  });
});

describe("Members in Settings -> People", () => {
  /* The hand-over is the danger zone's now, in `ProjectPanel.test.tsx`. */
  test("the role select offers no Owner, and the page holds still at phone width", async () => {
    const data = newProject();
    const nia = withPerson(data, "Nia Next", "admin");
    const { sent } = await renderWithBoard(<PeoplePanel mail={false} />, data, ({ path }) =>
      path.endsWith("/agents") ? { body: { agents: [] } } : undefined,
    );

    await page.viewport(375, 740);
    try {
      const role = page.getByLabelText(`Role of ${nia.name}`);
      await expect.element(role).toBeVisible();
      const doc = document.documentElement;
      expect(doc.scrollWidth - doc.clientWidth).toBeLessThanOrEqual(0);
      await expect.element(page.getByLabelText("Role of Ada Tester")).not.toBeInTheDocument();

      await role.click();
      await expect.element(page.getByRole("option", { name: "Admin", exact: true })).toBeVisible();
      expect(page.getByRole("option", { name: "Owner", exact: true }).elements()).toHaveLength(0);
      await page.getByRole("option", { name: "Member", exact: true }).click();
      await expect.poll(() => sent("PATCH").map((s) => s.body)).toEqual([{ role: "member" }]);
    } finally {
      await page.viewport(1440, 900);
    }
  });
});

describe("The members table", () => {
  test("reads as Person and Role, with 32px faces and a you tag on the viewer's row", async () => {
    const data = newProject();
    withPerson(data, "Nia Next");
    data.invites = [
      { email: "new@example.com", createdAt: new Date().toISOString(), live: true, role: "admin" },
    ];
    await renderWithBoard(<PeoplePanel mail={false} />, data, ({ path }) =>
      path.endsWith("/agents") ? { body: { agents: [] } } : undefined,
    );
    await expect.element(page.getByText("Person", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Role", { exact: true })).toBeVisible();
    const faces = [...document.querySelectorAll("[class*=memberFace] > *")];
    expect(faces.length).toBe(3);
    for (const face of faces) expect(face.getBoundingClientRect().width).toBe(32);
    // Only the viewer's own row says "you".
    const you = page.getByText("you", { exact: true });
    await expect.element(you).toBeVisible();
    expect(you.elements()).toHaveLength(1);
    expect(you.element().closest("[class*=memberWho]")?.textContent).toContain("Ada Tester");
    // A pending invite shows the role it joins with.
    await expect.element(page.getByTestId("invite-row")).toMatchTextContent(/Admin/);
  });

  test("an invite carries the role picked beside the email, Member by default", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(
      <PeoplePanel mail={false} />,
      data,
      ({ method, path }) => {
        if (path.endsWith("/agents")) return { body: { agents: [] } };
        if (method === "POST") return { status: 201, body: {} };
      },
    );
    const box = page.getByLabelText("Email of the new member");
    await box.fill("bo@example.com");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect
      .poll(() => sent("POST").map((s) => s.body))
      .toEqual([{ email: "bo@example.com", role: "member" }]);

    await box.fill("cy@example.com");
    await page.getByLabelText("Role of the new member").click();
    await page.getByRole("option", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Add member" }).click();
    await expect
      .poll(() => sent("POST").map((s) => s.body)[1])
      .toEqual({
        email: "cy@example.com",
        role: "admin",
      });
  });
});

describe("A member row on a phone", () => {
  test("at 390px every member row keeps its role and its remove button on screen", async () => {
    const data = newProject();
    const long = withPerson(data, "Bartholomew Maximilian Longname-Fitzgerald");
    long.email = "bartholomew.maximilian.longname-fitzgerald@a-very-long-domain.example.com";
    withPerson(data, "Ada Admin", "admin");
    withPerson(data, "Mo Member");
    await page.viewport(390, 844);
    try {
      await renderWithBoard(<PeoplePanel mail={false} />, data, ({ path }) =>
        path.endsWith("/agents") ? { body: { agents: [] } } : undefined,
      );
      const width = document.documentElement.clientWidth;
      const inside = (el: Element) => {
        const box = el.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      };
      for (const name of [long.name, "Ada Admin", "Mo Member"]) {
        const role = page.getByLabelText(`Role of ${name}`);
        await expect.element(role).toBeVisible();
        inside(role.element());
        inside(page.getByRole("button", { name: `Remove ${name}` }).element());
      }
      // The owner's own row reads its role as a word, in the same column.
      await expect.element(page.getByText("Owner", { exact: true })).toBeVisible();
      inside(page.getByText("Owner", { exact: true }).element());
      expect(document.documentElement.scrollWidth - width).toBeLessThanOrEqual(0);
    } finally {
      await page.viewport(1440, 900);
    }
  });
});

/*
 * The rules every agent reads sit under the agents, where an admin sets one
 * up. Who may write them, and that a claim carries them, are the route
 * tests' half.
 */
describe("Rules for every agent", () => {
  const PROJECT = /^\/api\/projects\/[0-9a-f-]+$/;
  const box = () => page.getByLabelText("Agent rules", { exact: true });

  /* The project route answers a patch; the board read after it carries it. */
  function rulesRoute(data: BoardData): Answer {
    const agents = agentsRoute([]);
    let project = data.project;
    return (sent) => {
      if (sent.method === "PATCH" && PROJECT.test(sent.path)) {
        project = { ...project, ...(sent.body as object) };
        return { body: { project } };
      }
      if (sent.method === "GET" && sent.path.endsWith("/board")) {
        return { body: { ...data, project } };
      }
      return agents(sent);
    };
  }

  async function drawRules(data: BoardData = newProject()) {
    const drawn = await renderWithBoard(<PeoplePanel mail={false} />, data, rulesRoute(data));
    return { ...drawn, patches: () => drawn.sent("PATCH", PROJECT) };
  }

  test("they sit after the agents, and the field saves on blur", async () => {
    const { patches } = await drawRules();
    await expect
      .poll(() =>
        page
          .getByRole("heading", { level: 2 })
          .elements()
          .map((h) => h.textContent),
      )
      .toEqual(["Members", "Agents", "Rules for every agent"]);

    const rules = "Review means the option Done.\nAsk a person before you estimate.";
    await box().fill(rules);
    await expect
      .element(page.getByTestId("agent-rules-count"))
      .toHaveTextContent(`${rules.length} / 2,000 characters`);
    await expect
      .element(
        page.getByText("Every agent reads this when it claims a task, and obeys it.", {
          exact: false,
        }),
      )
      .toBeVisible();
    expect(patches()).toHaveLength(0);

    (box().element() as HTMLTextAreaElement).blur();
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].body).toEqual({ agentRules: rules });

    // One change, one write: a focus and a blur that changed nothing send none.
    (box().element() as HTMLTextAreaElement).focus();
    (box().element() as HTMLTextAreaElement).blur();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(patches()).toHaveLength(1);
  });

  test("a long text says that every run carries it", async () => {
    await drawRules();
    await box().fill("x".repeat(2100));
    await expect
      .element(
        page.getByText("Every run carries the whole text, so a shorter one costs less.", {
          exact: false,
        }),
      )
      .toBeVisible();
  });

  test("the rules are saved although the tab was closed on the box", async () => {
    const { patches } = await drawRules();
    await box().fill("Done means merged.");

    // The box still has the focus. A closed tab raises pagehide and no blur.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].body).toEqual({ agentRules: "Done means merged." });
    // Only a keepalive request outlives the page that sent it.
    const leave = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(leave?.[1]?.keepalive).toBe(true);
  });

  test("a member reads them and cannot change them", async () => {
    const data = newProject();
    data.project.role = "member";
    data.project.agentRules = "Done means merged.";
    await drawRules(data);
    await expect.element(box()).toHaveValue("Done means merged.");
    await expect.element(box()).toBeDisabled();
    await expect
      .element(page.getByText("Only the owner or an admin can change the agent rules."))
      .toBeVisible();
  });
});
