import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activity,
  comments,
  projectMembers,
  projects,
  properties,
  taskValues,
  tasks,
  users,
} from "@/db/schema";
import {
  addresseesOf,
  askLink,
  askMail,
  ASK_MAIL_AFTER_MS,
  isDue,
  questionOf,
  type AskMember,
} from "../ask-mail";

/**
 * A question an agent asked, emailed once after a quiet delay.
 *
 * The rules are read without a database. The sender is read with one that
 * answers by table, so what is under test is the road: nothing read with
 * mail off, one claim before any send, and one email to the person the rule
 * picks.
 */
const fake = vi.hoisted(() => {
  type Builder = Record<string, (...args: unknown[]) => unknown> & {
    then: (ok: (rows: unknown[]) => unknown, fail?: (e: unknown) => unknown) => Promise<unknown>;
  };
  const reads = new Map<unknown, unknown[]>();
  let claim: unknown[] = [];
  const claims: Record<string, unknown>[] = [];
  let statements = 0;

  const builder = (rows: () => unknown[]): Builder => {
    let table: unknown = null;
    const node = {
      from: (t: unknown) => {
        table = t;
        return node;
      },
      innerJoin: () => node,
      where: () => node,
      orderBy: () => node,
      limit: () => node,
      set: (values: unknown) => {
        claims.push(values as Record<string, unknown>);
        return node;
      },
      returning: () => node,
      then: (ok: (rows: unknown[]) => unknown, failed?: (e: unknown) => unknown) =>
        Promise.resolve(table ? (reads.get(table) ?? []) : rows()).then(ok, failed),
    } as unknown as Builder;
    return node;
  };

  return {
    claims,
    db: {
      select: () => {
        statements += 1;
        return builder(() => []);
      },
      update: () => {
        statements += 1;
        // A claim answers its rows once; the next look finds them taken.
        return builder(() => {
          const rows = claim;
          claim = [];
          return rows;
        });
      },
    },
    statements: () => statements,
    answers: (table: unknown, rows: unknown[]) => reads.set(table, rows),
    claimable: (rows: unknown[]) => {
      claim = rows;
    },
    forget: () => {
      reads.clear();
      claim = [];
      claims.length = 0;
      statements = 0;
    },
  };
});

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("../mail", async (importOriginal) => {
  const real = await importOriginal<typeof import("../mail")>();
  return {
    ...real,
    sendMail: vi.fn(async (mail: { to: string; subject: string; text: string }) => {
      sent.push(mail);
      return true;
    }),
  };
});

const { sendDueAsks } = await import("../ask-sender");

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes));

describe("when an ask is due", () => {
  const asked = { status: "waiting", askedAt: at(0), askMailedAt: null, answeredAt: null };

  it("is not due inside the quiet delay", () => {
    expect(isDue(asked, at(14))).toBe(false);
  });

  it("is due once fifteen quiet minutes have passed", () => {
    expect(ASK_MAIL_AFTER_MS).toBe(15 * 60_000);
    expect(isDue(asked, at(15))).toBe(true);
  });

  it("is never due a second time", () => {
    expect(isDue({ ...asked, askMailedAt: at(15) }, at(90))).toBe(false);
  });

  it("is not due when the run stopped waiting inside the delay", () => {
    expect(isDue({ ...asked, status: "running" }, at(30))).toBe(false);
    expect(isDue({ ...asked, status: "done" }, at(30))).toBe(false);
  });

  it("is not due when a person answered with a comment the agent has not read yet", () => {
    expect(isDue({ ...asked, answeredAt: at(5) }, at(30))).toBe(false);
  });

  it("is still due when the only comment was written before the question", () => {
    expect(isDue({ ...asked, askedAt: at(10), answeredAt: at(5) }, at(30))).toBe(true);
  });

  it("is never due for a hand-over, which asks nobody anything", () => {
    expect(isDue({ ...asked, status: "handed_over" }, at(30))).toBe(false);
  });
});

describe("who the email goes to", () => {
  const person = (id: string, more: Partial<AskMember> = {}): AskMember => ({
    id,
    kind: "human",
    role: "member",
    email: `${id}@example.com`,
    askMail: true,
    ...more,
  });
  const members = [
    person("ann", { role: "owner" }),
    person("bob", { role: "admin" }),
    person("cy"),
    person("dee"),
    person("bot", { kind: "agent", email: null }),
  ];
  // Reviewer sits above Assignee in Settings, so it is the one asked first.
  const props = [
    { id: "status", type: "select" },
    { id: "reviewer", type: "person" },
    { id: "assignee", type: "person" },
  ];
  const ids = (list: AskMember[]) => list.map((m) => m.id);

  it("is the first person property, in the Settings order, that holds a person", () => {
    const to = addresseesOf({
      properties: props,
      values: { reviewer: "cy", assignee: "dee" },
      members,
      touchers: ["bob"],
    });
    expect(ids(to)).toEqual(["cy"]);
  });

  it("skips a person property that holds an agent", () => {
    const to = addresseesOf({
      properties: props,
      values: { reviewer: "bot", assignee: "dee" },
      members,
      touchers: [],
    });
    expect(ids(to)).toEqual(["dee"]);
  });

  it("is the last person who touched the task when nobody is assigned", () => {
    const to = addresseesOf({
      properties: props,
      values: {},
      members,
      touchers: ["gone", "dee", "cy"],
    });
    // "gone" left the project, so the newest member is next.
    expect(ids(to)).toEqual(["dee"]);
  });

  it("is every owner and admin when nobody is assigned and no person touched it", () => {
    const to = addresseesOf({ properties: props, values: {}, members, touchers: [] });
    expect(ids(to)).toEqual(["ann", "bob"]);
  });

  it("goes to nobody when the person it is for turned these emails off", () => {
    const off = members.map((m) => (m.id === "cy" ? { ...m, askMail: false } : m));
    const to = addresseesOf({
      properties: props,
      values: { reviewer: "cy" },
      members: off,
      touchers: ["dee"],
    });
    expect(to).toEqual([]);
  });

  it("leaves out an owner or admin who turned them off", () => {
    const off = members.map((m) => (m.id === "ann" ? { ...m, askMail: false } : m));
    const to = addresseesOf({ properties: props, values: {}, members: off, touchers: [] });
    expect(ids(to)).toEqual(["bob"]);
  });
});

describe("the email", () => {
  it("carries the project, the key and title, the agent, the question and one link", () => {
    const mail = askMail({
      to: "cy@example.com",
      project: "Ushabti",
      key: "USH-14",
      title: "Pick a queue",
      agent: "Reis",
      question: "Which service owns the queue?",
      link: askLink("https://board.example.com", "p-1", "USH-14"),
    });
    expect(mail.to).toBe("cy@example.com");
    expect(mail.subject).toContain("USH-14");
    for (const words of ["Ushabti", "USH-14", "Pick a queue", "Reis", "Which service owns"]) {
      expect(mail.text).toContain(words);
    }
    const links = mail.text.match(/https?:\/\/\S+/g);
    expect(links).toEqual(["https://board.example.com/p/p-1?task=USH-14"]);
  });

  it("reads the whole question from the agent's comment when the step was cut", () => {
    const long = `${"word ".repeat(60).trim()} and the end`;
    const step = `${long.slice(0, 197)}…`;
    expect(questionOf(step, ["Something else", long])).toBe(long);
    expect(questionOf("Short one?", ["Unrelated"])).toBe("Short one?");
  });
});

describe("the sender", () => {
  const on = {
    SMTP_URL: "smtp://127.0.0.1:2525",
    MAIL_FROM: "b@x.com",
    USHABTI_URL: "https://b.x",
  };

  beforeEach(() => {
    fake.forget();
    sent.length = 0;
    fake.answers(projects, [{ name: "Ushabti", key: "USH" }]);
    fake.answers(tasks, [{ number: 14, title: "Pick a queue" }]);
    fake.answers(users, [{ name: "Reis" }]);
    fake.answers(properties, [{ id: "assignee", type: "person" }]);
    fake.answers(taskValues, [{ propertyId: "assignee", value: "cy" }]);
    fake.answers(projectMembers, [
      { id: "ann", kind: "human", role: "owner", email: "ann@x.com", askMail: true },
      { id: "cy", kind: "human", role: "member", email: "cy@x.com", askMail: true },
    ]);
    fake.answers(activity, []);
    fake.answers(comments, []);
  });

  const due = {
    projectId: "p-1",
    taskId: "t-1",
    agentId: "a-1",
    step: "Which service owns the queue?",
    askedAt: at(0),
  };

  it("sends one email to the assignee, with a link that opens the task", async () => {
    fake.claimable([due]);
    expect(await sendDueAsks(() => at(15), on)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("cy@x.com");
    expect(sent[0].text).toContain("https://b.x/p/p-1?task=USH-14");
    // The claim is the mark, and it is written before the send.
    expect(fake.claims[0].askMailedAt).toEqual(at(15));
  });

  it("never sends a second email for the same ask", async () => {
    fake.claimable([due]);
    await sendDueAsks(() => at(15), on);
    await sendDueAsks(() => at(60), on);
    expect(sent).toHaveLength(1);
  });

  it("with mail off sends nothing, reads nothing and does not fail", async () => {
    fake.claimable([due]);
    const off = { USHABTI_URL: "https://b.x" };
    await expect(sendDueAsks(() => at(15), off)).resolves.toBe(0);
    expect(fake.statements()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("is off without the board's own address, as Forgot password is", async () => {
    fake.claimable([due]);
    await sendDueAsks(() => at(15), { SMTP_URL: on.SMTP_URL, MAIL_FROM: on.MAIL_FROM });
    expect(fake.statements()).toBe(0);
  });
});
