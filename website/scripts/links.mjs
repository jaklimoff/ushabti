// Every link on the built site has to land on a page that exists.
//
// The trap this catches: Starlight prefixes the base path onto sidebar links
// by itself, but NOT onto the hero actions in a page's front matter, and not
// onto a plain markdown link. Those have to carry `/ushabti/` themselves, and
// a checker that only looks at links which already have it will never notice.
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const base = (process.env.SITE_BASE ?? "/ushabti").replace(/\/$/, "");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const files = await walk(dist);
const asUrl = (file) => "/" + relative(dist, file).split("\\").join("/");
const present = new Set(files.map(asUrl));
for (const file of files) {
  if (file.endsWith("index.html")) present.add(asUrl(file).replace(/index\.html$/, ""));
}

const broken = new Map();
const note = (target, page, why) => {
  const key = `${target}  (${why})`;
  if (!broken.has(key)) broken.set(key, new Set());
  broken.get(key).add(relative(dist, page));
};

for (const page of files.filter((f) => f.endsWith(".html"))) {
  const html = await readFile(page, "utf8");
  for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const target = href.split(/[#?]/)[0];
    if (!target) continue;
    if (base && !target.startsWith(base + "/") && target !== base) {
      note(target, page, "missing the base path");
      continue;
    }
    let path = base ? target.slice(base.length) || "/" : target;
    if (!path.endsWith("/") && !extname(path)) path += "/";
    if (!present.has(path)) note(target, page, "no such page");
  }
}

if (broken.size) {
  console.error(`\n[links] ${broken.size} broken target(s):\n`);
  for (const [target, pages] of broken) {
    console.error(`  ${target}\n      on ${[...pages].slice(0, 6).join(", ")}`);
  }
  process.exit(1);
}

const pages = files.filter((f) => f.endsWith(".html")).length;
console.log(`[links] every link resolves, across ${pages} pages.`);
