// Puts the static files where the standalone server looks for them.
//
// `output: "standalone"` writes a server that serves `.next/static` and
// `public` from its own folder, but `next build` never copies them there: they
// are meant for a CDN. The image does the copy between two Docker stages. On a
// machine there is no second stage, so `npm run start` runs this first.
//
// It loads nothing. It runs before the server, from a tree that may hold only
// what the build left, and a dependency here would be one more thing between a
// person and a working start.
import { existsSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("No .next/standalone/server.js. Run `npm run build` first.");
  process.exit(1);
}

// The old copy is removed first. A rebuild writes a new chunk under a new name
// and leaves the old one here, and a folder that only ever grows hides the day
// the build stops writing a file at all.
for (const [from, to] of [
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
  [join(root, "public"), join(standalone, "public")],
]) {
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
