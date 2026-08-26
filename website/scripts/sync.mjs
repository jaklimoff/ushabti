// CHANGELOG.md, ROADMAP.md, CONTRIBUTING.md and SECURITY.md belong to the repo.
// The site reads them from there and adds a front matter block, so a release
// note is never written twice and never drifts.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const docs = join(here, "..", "src", "content", "docs");

const pages = [
  {
    from: "CHANGELOG.md",
    to: "releases/changelog.md",
    title: "Changelog",
    description: "What changed in each release of Ushabti.",
    lede: "Every release, newest first. Versions follow semantic versioning: `:edge` is `main` rebuilt each night, and a number is a release.",
  },
  {
    from: "ROADMAP.md",
    to: "releases/roadmap.md",
    title: "Roadmap",
    description: "What is done, what comes next, and what Ushabti will never do.",
    lede: "Where Ushabti is and where it goes next — including the list of things it will not do, which is the more useful half.",
  },
  {
    from: "CONTRIBUTING.md",
    to: "internals/contributing.md",
    title: "Contributing",
    description: "How to set up, test and send a change to Ushabti.",
    lede: "Ushabti is small on purpose, and it stays small. This is how to work on it.",
  },
  {
    from: "SECURITY.md",
    to: "internals/security.md",
    title: "Security",
    description: "How to report a weakness in Ushabti, and what is already known.",
    lede: "Read this before you put Ushabti anywhere a stranger can reach it.",
  },
];

// Links in the repo point at repo files. On the site they must point at pages.
const rewrites = [
  [/\]\(CHANGELOG\.md\)/g, "](/ushabti/releases/changelog/)"],
  [/\]\(ROADMAP\.md\)/g, "](/ushabti/releases/roadmap/)"],
  [/\]\(CONTRIBUTING\.md\)/g, "](/ushabti/internals/contributing/)"],
  [/\]\(SECURITY\.md\)/g, "](/ushabti/internals/security/)"],
  [/\]\(docs\/agents\.md\)/g, "](/ushabti/agents/)"],
  [/\]\(LICENSE\)/g, "](https://github.com/jaklimoff/ushabti/blob/main/LICENSE)"],
  [
    /\]\(CODE_OF_CONDUCT\.md\)/g,
    "](https://github.com/jaklimoff/ushabti/blob/main/CODE_OF_CONDUCT.md)",
  ],
  [/\]\(README\.md\)/g, "](/ushabti/)"],
];

const escape = (value) => value.replace(/"/g, '\\"');

for (const page of pages) {
  const raw = await readFile(join(repo, page.from), "utf8");
  // The repo file opens with its own H1. The page title replaces it.
  let body = raw.replace(/^#\s+.*\n+/, "");
  for (const [pattern, replacement] of rewrites) body = body.replace(pattern, replacement);

  const front = [
    "---",
    `title: ${page.title}`,
    `description: "${escape(page.description)}"`,
    "editUrl: false",
    "---",
    "",
    `:::note[From the repository]`,
    `${page.lede} This page is built from [\`${page.from}\`](https://github.com/jaklimoff/ushabti/blob/main/${page.from}) at every deploy.`,
    ":::",
    "",
  ].join("\n");

  await writeFile(join(docs, page.to), front + body);
  console.log(`[sync] ${page.from} → src/content/docs/${page.to}`);
}
