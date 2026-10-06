import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The GitHub Actions step that puts a pull request on its tasks, run as
 * GitHub runs it. The script is read out of the file the docs show, so a test
 * can never pass on a copy that a team does not get.
 */
export const WORKFLOW = path.resolve(process.cwd(), "examples/github/ushabti-links.yml");

/** The commit and the path that BOARD_MJS names in the workflow. */
export function boardMjsPin(): { sha: string; file: string } {
  const url = readFileSync(WORKFLOW, "utf8").match(/BOARD_MJS: (\S+)/)?.[1] ?? "";
  const pin = url.match(
    /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([0-9a-f]{40})\/(.+)$/,
  );
  if (!pin) throw new Error(`BOARD_MJS is not pinned to a commit: ${url}`);
  return { sha: pin[1], file: pin[2] };
}

/**
 * The board.mjs a team gets: the file at the pinned commit, read out of this
 * clone. A server change that breaks it breaks every team that copied the
 * workflow, while this checkout's copy may already have moved on.
 */
export function pinnedBoardMjs(): Buffer {
  const { sha, file } = boardMjsPin();
  try {
    // In the CI container the checkout belongs to another user, and git
    // refuses a repository it does not own.
    const cwd = process.cwd();
    return execFileSync("git", ["-c", `safe.directory=${cwd}`, "show", `${sha}:${file}`], {
      cwd,
      stdio: "pipe",
    });
  } catch (error) {
    const said = String((error as { stderr?: Buffer }).stderr ?? error).trim();
    throw new Error(
      `git show ${sha}:${file} failed: ${said}\nA shallow checkout needs fetch-depth: 0.`,
    );
  }
}

/** Which board.mjs the step downloads: this checkout's, or the pinned one. */
export type BoardMjs = "checkout" | "pinned";

/**
 * A repository of its own in a temp folder, on the pull request's branch,
 * with one commit that holds the board.mjs the test asked for. The step
 * downloads from it, so a test never reaches for origin.
 */
function repoFor(branch: string, board: BoardMjs): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ushabti-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--quiet", `--initial-branch=${branch || "main"}`);
  const { file } = boardMjsPin();
  mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
  writeFileSync(
    path.join(dir, file),
    board === "pinned" ? pinnedBoardMjs() : readFileSync(path.resolve(process.cwd(), file)),
  );
  git("add", file);
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "board.mjs",
  );
  return { dir, sha: git("rev-parse", "HEAD") };
}

/** The lines under `run: |`, without their indent. */
export function stepScript(): string {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "run: |");
  if (start < 0) throw new Error("The workflow has no run block.");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

/** What GitHub fills in from the event, the variables and the secret. */
export type StepInput = {
  url: string;
  token: string;
  projectKey: string;
  title: string;
  branch: string;
  prUrl: string;
  linkProperty?: string;
  /** This checkout's copy unless a test asks for the one teams pin. */
  board?: BoardMjs;
};

/**
 * Runs the step in a folder of its own. `curl` is replaced by one that reads
 * the commit and the path out of the URL and takes the file from the test's
 * own repository, so the test needs no GitHub and no network. The answer
 * carries the board.mjs the step ran, so a test can say which one it was.
 */
export function runStep(
  input: StepInput,
): Promise<{ code: number | null; output: string; boardMjs: string }> {
  const repo = repoFor(input.branch, input.board ?? "checkout");
  const dir = mkdtempSync(path.join(tmpdir(), "ushabti-step-"));
  const curl = path.join(dir, "bin", "curl");
  mkdirSync(path.dirname(curl));
  writeFileSync(
    curl,
    [
      "#!/bin/sh",
      'for arg; do case "$arg" in https://*) url="$arg";; esac; done',
      'while [ "$1" != "-o" ]; do shift; done',
      'pin=$(echo "$url" | cut -d/ -f6-)',
      `git -C "${repo.dir}" show "\${pin%%/*}:\${pin#*/}" > "$2"`,
      "",
    ].join("\n"),
  );
  chmodSync(curl, 0o755);

  const child = spawn("bash", ["-e", "-c", stepScript()], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${path.dirname(curl)}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      USHABTI_URL: input.url,
      USHABTI_TOKEN: input.token,
      PROJECT_KEY: input.projectKey,
      LINK_PROPERTY: input.linkProperty ?? "Pull requests",
      PR_TITLE: input.title,
      PR_BRANCH: input.branch,
      PR_URL: input.prUrl,
      BOARD_MJS: `https://raw.githubusercontent.com/acme/shop/${repo.sha}/${boardMjsPin().file}`,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const downloaded = () => {
    try {
      return readFileSync(path.join(dir, "board.mjs"), "utf8");
    } catch {
      return "";
    }
  };
  return new Promise((done) =>
    child.on("close", (code) => done({ code, output, boardMjs: downloaded() })),
  );
}
