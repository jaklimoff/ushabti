# Ushabti's rules for the builder

These are Ushabti's rules. Setmaat's brief holds the rest. `AGENTS.md` and
`CONTRIBUTING.md` hold the design rules, the style and the checks: read them
before you change the code.

## While you build

- A user would notice the change: add a line to `CHANGELOG.md` under "Unreleased". Read only the top of that file.
- The database changed: edit `src/db/schema.ts`, run `npm run db:generate`, and keep the new file in `drizzle/`. Say in the report that the task carries a migration: two branches that each add one collide at the merge.
- A write that reads an invariant and then changes it (one owner, one main view, one open run) takes the project lock. Check that every other route that writes the same rows takes it too.
- An async answer that comes back after the person moved on must not land on the new question. Tie each answer to what asked for it (an id or a request counter), and drop it when that has changed.
- A write that Enter or a press starts ignores the same key and press until its answer comes.
- A change to any word or width in the top bar breaks the small-tablet tests in `src/components/board/Board.test.tsx`. Run them after each such change: `npx vitest run --project browser src/components/board/Board.test.tsx`.
- Run only the specs you write or change while you build, each on a throwaway server of this checkout's own build: `sh .setmaat/e2e.sh e2e/<name>.spec.ts --repeat-each=5`. It starts and removes its own containers; start no other Docker containers, and stop none.
- A change that a person sees adds or changes an e2e spec that opens that screen: the loop's reviewer sees the screenshots of the specs the task changed. When the end state of the test is not the screen, the spec saves it with `page.screenshot({ path: testInfo.outputPath("seen-<name>.png") })`.
- Find the place with `grep -n` first, then read only the lines you need. Do not read a file of more than about 300 lines whole.
- Never touch `infra/`, production or a deploy.

## When you prove it

- Run `npm run format` before the check: the check runs `format:check`.
- The loop's check (`.setmaat/check.sh`) runs the fast checks, then the `@smoke` specs and the specs the task changed, through `.setmaat/e2e.sh` on a throwaway server of the task's own build. When the task changes `e2e/helpers.ts`, `src/test/fixtures` or `playwright.config.ts`, it runs every spec instead. One end-to-end run uses this Mac at a time, under a lock in `~/.local/state/ushabti/` that `e2e.sh` takes. Do not run `check.sh`, the whole suite or `e2e.sh` with no spec named yourself before `done`: the loop runs the check, and a long run holds the lock for everyone. Run only the specs you wrote or changed, with `sh .setmaat/e2e.sh e2e/<name>.spec.ts --repeat-each=5`: a new end-to-end test passes five times in a row before you land.
- The webhook specs and `e2e/reset.spec.ts:100` fail against `next dev` on this machine, whatever the change. Do not try to fix them in a task that does not touch them.
- The commit message is plain English and names the outcome, with no `type(scope):` prefix. This replaces that form in the report's `Commit` line: `Commit ushabti: <the outcome> (USH-NN)`. For example `A value picked while a task is being archived stays on the panel`. It becomes the title of the pull request; the commit body becomes its description (what, why, and how to see the change in the running app, in two or three sentences).
- In the report, the `Check run:` line is: `Check run: check pass|fail; e2e full|specs pass|fail`. `Checks:` stays as Setmaat's brief says: one `- [x] <item>: <proof>` line for each checklist item, copied exactly.
