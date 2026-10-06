import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boardMjsPin, pinnedBoardMjs, runStep, WORKFLOW } from "./workflow-step";

/**
 * The documented GitHub Actions step, against a board that remembers what was
 * put. The end to end spec runs it against the real one.
 */
const PR = "https://github.com/acme/shop/pull/12";

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

type Prop = { id: string; name: string; type: string };

async function fakeBoard(
  properties: Prop[] = [{ id: "p-prs", name: "Pull requests", type: "link" }],
  status = 200,
  putStatus = 200,
) {
  const puts: { task: string; value: unknown }[] = [];
  const tasks = [
    { id: "t12", key: "USH-12", values: {} },
    { id: "t123", key: "USH-123", values: {} },
    { id: "t7", key: "USH-7", values: {} },
  ];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = {};
      const detail = req.url?.match(/^\/api\/tasks\/(\w+)$/);
      const put = req.url?.match(/^\/api\/tasks\/(\w+)\/values\/p-prs$/);
      if (req.url === "/api/agent/me") body = { agent: { name: "CI" }, project: { id: "p1" } };
      else if (req.url === "/api/projects/p1/board") {
        body = {
          project: { id: "p1", name: "Demo", key: "USH" },
          properties: properties.map((p) => ({ ...p, options: [] })),
          members: [],
          tasks,
          runs: [],
          archived: [{ id: "t5", key: "USH-5", values: {} }],
        };
      } else if (req.method === "PUT" && put) {
        const value = (JSON.parse(raw) as { value: string[] }).value;
        if (putStatus !== 200 && put[1] === "t7") {
          res.writeHead(putStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "The board is down." }));
          return;
        }
        puts.push({ task: put[1], value });
        body = { value };
      } else if (detail) {
        body = { task: { title: "", description: "", values: {}, checklist: [], comments: [] } };
      }
      if (status !== 200) body = { error: "That token is not valid." };
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, puts };
}

const base = { token: "ush_test", projectKey: "USH", prUrl: PR };

describe("The GitHub Actions step", () => {
  it("adds the pull request to every key in the title and the branch", async () => {
    const { url, puts } = await fakeBoard();
    const result = await runStep({
      ...base,
      url,
      title: "Fix the cart (USH-7)",
      branch: "feature-ush-123-cart",
    });
    expect(result.code).toBe(0);
    expect(puts).toEqual([
      { task: "t7", value: [PR] },
      { task: "t123", value: [PR] },
    ]);
  });

  it("never reads USH-123 as USH-12, nor a key inside a longer word", async () => {
    const { url, puts } = await fakeBoard();
    await runStep({ ...base, url, title: "USH-123 and xUSH-12 and USH-12a", branch: "main" });
    expect(puts).toEqual([{ task: "t123", value: [PR] }]);
  });

  it("names the same task once when the title and the branch both carry it", async () => {
    const { url, puts } = await fakeBoard();
    await runStep({ ...base, url, title: "USH-7: fix", branch: "ush-7-fix" });
    expect(puts).toEqual([{ task: "t7", value: [PR] }]);
  });

  it("gets no body to read", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    expect(workflow).toContain("PR_TITLE: ${{ github.event.pull_request.title }}");
    expect(workflow).toContain("PR_BRANCH: ${{ github.event.pull_request.head.ref }}");
    expect(workflow).not.toMatch(/pull_request\.body/);
  });

  it("writes a line for a key that is not on the board, and goes on", async () => {
    const { url, puts } = await fakeBoard();
    const result = await runStep({ ...base, url, title: "USH-99 then USH-7", branch: "x" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("No task USH-99 on this board.");
    expect(result.output).toContain("USH-99: the link was not added.");
    expect(puts).toEqual([{ task: "t7", value: [PR] }]);
  });

  it("writes a line for a key whose task is archived, and goes on", async () => {
    const { url, puts } = await fakeBoard();
    const result = await runStep({ ...base, url, title: "USH-5 then USH-7", branch: "x" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("USH-5 is archived.");
    expect(result.output).toContain("USH-5: the link was not added.");
    expect(puts).toEqual([{ task: "t7", value: [PR] }]);
  });

  it("writes a line, and does not fail, on a board with no Link property", async () => {
    const { url, puts } = await fakeBoard([{ id: "p-st", name: "Status", type: "select" }]);
    const result = await runStep({ ...base, url, title: "USH-7", branch: "x" });
    expect(result.code).toBe(0);
    expect(result.output).toContain('No property called "Pull requests"');
    expect(result.output).toContain("USH-7: the link was not added.");
    expect(puts).toEqual([]);
  });

  it("writes a line, and does not fail, when the property is not a Link", async () => {
    const { url } = await fakeBoard([{ id: "p-st", name: "Pull requests", type: "text" }]);
    const result = await runStep({ ...base, url, title: "USH-7", branch: "x" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("--add is for a Link property.");
  });

  it("does nothing, and does not fail, without a token or a key", async () => {
    const { url, puts } = await fakeBoard();
    const fork = await runStep({ ...base, url, token: "", title: "USH-7", branch: "x" });
    expect(fork.code).toBe(0);
    expect(fork.output).toContain("No USHABTI_TOKEN secret.");
    const none = await runStep({ ...base, url, title: "Tidy up", branch: "tidy" });
    expect(none.code).toBe(0);
    expect(none.output).toContain("No USH key in the title or the branch.");
    expect(puts).toEqual([]);
  });

  it("fails the job when the token is refused, and writes nothing", async () => {
    const { url, puts } = await fakeBoard(undefined, 401);
    const result = await runStep({ ...base, url, title: "USH-7", branch: "x" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("did not take the token");
    expect(puts).toEqual([]);
  });

  it("fails the job when the board does not answer", async () => {
    const { url } = await fakeBoard();
    server!.close();
    server = null;
    const result = await runStep({ ...base, url, title: "USH-7", branch: "x" });
    expect(result.code).toBe(1);
    expect(result.output).toContain(`The board at ${url} did not take the token.`);
  });

  it("fails the job when the board refuses a write, after it tries every key", async () => {
    const { url, puts } = await fakeBoard(undefined, 200, 500);
    const result = await runStep({ ...base, url, title: "USH-7 and USH-12", branch: "x" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("The board is down.");
    expect(result.output).toContain("USH-7: the board did not take the link.");
    expect(puts).toEqual([{ task: "t12", value: [PR] }]);
  });

  it("fails the job when the board address is not set", async () => {
    const result = await runStep({ ...base, url: "", title: "USH-7", branch: "x" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("Set the repository variables USHABTI_URL");
  });

  it("downloads board.mjs from a fixed commit, never from a branch", () => {
    expect(boardMjsPin()).toEqual({
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      file: "examples/skill/ushabti/board.mjs",
    });
  });

  it("runs this checkout's board.mjs unless a test asks for the pinned one", async () => {
    const { url } = await fakeBoard();
    const checkout = readFileSync(path.resolve(process.cwd(), boardMjsPin().file), "utf8");
    const { sha, file } = boardMjsPin();
    const pinned = execFileSync("git", ["show", `${sha}:${file}`], { encoding: "utf8" });
    expect(pinnedBoardMjs().toString("utf8")).toEqual(pinned);

    const ours = await runStep({ ...base, url, title: "USH-7", branch: "x" });
    expect(ours.boardMjs).toEqual(checkout);

    const theirs = await runStep({ ...base, url, title: "USH-7", branch: "x", board: "pinned" });
    expect(theirs.code).toBe(0);
    expect(theirs.boardMjs).toEqual(pinned);
  });

  it("is shown whole in both places a team copies it from", () => {
    const workflow = readFileSync(WORKFLOW, "utf8").trimEnd();
    for (const page of ["docs/agents.md", "website/src/content/docs/agents/github.mdx"]) {
      expect(readFileSync(path.resolve(process.cwd(), page), "utf8")).toContain(workflow);
    }
  });
});
