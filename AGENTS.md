# Working on Ushabti

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. It has the set-up, the checks
that must pass, the style, and how a release is made. [ROADMAP.md](ROADMAP.md)
says what the project will not do. This page holds only what those two do not,
and what is easy to get wrong.

- **No task field is hardcoded.** Not Status, not Priority, not a due date.
  Every field on a task is a property somebody defined. A change that adds a
  fixed field works against the whole idea, however small it looks. Add a
  property type instead.
- **`scripts/migrate.mjs` runs outside the traced server.** The image ships
  Next's standalone output, which carries only the files the build saw the
  server touch. Nothing imports the migration script, so its packages are named
  by hand in `outputFileTracingIncludes` in `next.config.mjs`. Add an import to
  that script without adding it there and the image builds, starts, and dies on
  the first line.
- **The end to end tests serve the production build when `CI` is set.** They
  used to serve `next dev`, which hid a real fault for months. If a test passes
  locally and fails on CI, run it with `CI=1` before you suspect CI.
- **Write short plain sentences**, in the interface, in comments and in commit
  messages. Comments say why, never what.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
