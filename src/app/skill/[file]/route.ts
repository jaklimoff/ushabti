import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The skill, served by the board it talks to.
 *
 * The settings page tells a person to run two curl commands. It used to tell
 * them to read `docs/agents.md`, which is not on the machine of anybody who
 * deployed the production image, and to copy a folder out of a repo they had
 * no reason to clone.
 *
 * These two files are not imported by anything, so the tracer never sees
 * them: they are named by hand in `outputFileTracingIncludes`.
 */
const FILES: Record<string, string> = {
  "SKILL.md": "text/markdown; charset=utf-8",
  "board.mjs": "text/javascript; charset=utf-8",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const type = FILES[file];
  if (!type) return new Response("Not found.", { status: 404 });

  try {
    const body = await readFile(path.join(process.cwd(), "examples/skill/ushabti", file), "utf8");
    return new Response(body, {
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  } catch {
    return new Response("The skill is not in this build.", { status: 404 });
  }
}
