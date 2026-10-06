// Docker Desktop does not pass the event for a new file through the bind
// mount, so `next dev` in the container never learns of a route folder added
// while it runs and answers 404 until a restart. Turbopack's own polling
// (`watchOptions.pollIntervalMs`) finds the folder, but it scans the whole
// tree, `node_modules` too: it burns a core and stops seeing edits. This looks
// only at src/app, once a second, and when a route file comes or goes it
// touches next.config.mjs, which `next dev` answers by restarting itself.
// docker-compose.yml starts it beside the dev server; nothing else runs it.

import { readdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The special files of the app router, and the metadata files, which are
// routes too: /sitemap.xml, /icon and the rest.
const ROUTE_FILE =
  /^(page|route|layout|template|default|loading|error|global-error|not-found|forbidden|unauthorized|sitemap|robots|manifest|favicon|(apple-)?icon\d*|(opengraph|twitter)-image\d*)\.[a-z]+$/;

export function routeFiles(appDir) {
  return new Set(
    readdirSync(appDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && ROUTE_FILE.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  );
}

export function sameFiles(before, after) {
  return before.size === after.size && [...after].every((f) => before.has(f));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appDir = path.resolve("src/app");
  const config = path.resolve("next.config.mjs");
  let known = routeFiles(appDir);
  setInterval(() => {
    let now;
    try {
      now = routeFiles(appDir);
    } catch {
      // A folder renamed while it was read. The next second reads it whole.
      return;
    }
    if (sameFiles(known, now)) return;
    const time = new Date();
    try {
      utimesSync(config, time, time);
    } catch {
      // next.config.mjs is gone for a moment, as in a checkout. Keep the old
      // list, so the next second tries again.
      return;
    }
    known = now;
    console.log("A route file came or went: restarting next dev.");
  }, 1000);
}
