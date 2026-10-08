# Contributing

Thank you for your interest. Ushabti is small on purpose, and it stays small.
This page tells you how to work on it.

## Before you write code

Open an issue first for anything larger than a bug fix. A short description of
the problem is enough. This prevents wasted work on a change that does not fit
the project.

Read [ROADMAP.md](ROADMAP.md) first. It lists what comes next and what the
project will not do.

## Set up

You need Docker. Nothing else.

```bash
cp .env.example .env
docker compose up
docker compose exec app npm run db:seed   # demo data, in a second terminal
```

The app is then at <http://localhost:3050>.

`docker compose up` also starts RustFS, the store a task's files go to, and
the app makes the bucket `ushabti` in it as it starts. RustFS shares the
network of `app`, so it is
at <http://localhost:9050> both inside the container and on your machine: a
signed URL names the host it was signed for, and the server and the browser
must reach the bucket by the same one. `app` gets the `S3_*` values for it.
Unset `S3_BUCKET` in a `docker-compose.override.yml` to work with attachments
off. The variables are in [README.md](README.md#files-on-a-task).

To stop a secret before it leaves your machine, install
[gitleaks](https://github.com/gitleaks/gitleaks) and turn on the hook once per
clone:

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-push` then scans the commits each push adds, and refuses the
push if one of them holds a key, a token or a password.

The dev server answers `localhost` and blocks its own live-reload resources for
every other name. Reached by another name, the page never comes alive and the
login form posts as plain HTML with no error on screen. To reach it from another
computer by a name, set `ALLOWED_DEV_ORIGINS` to those names, comma separated.
In a `docker-compose.override.yml`, give them to the app:

```yaml
services:
  app:
    environment:
      ALLOWED_DEV_ORIGINS: mini-m4.local,192.168.1.8
```

Outside Docker the shell does the same: `ALLOWED_DEV_ORIGINS=mini-m4.local npm run dev`.

Write the host name only, without the scheme and without the port.
`next.config.mjs` reads the variable, and only `next dev` uses it. Unset, the
default stands, and the production build is the same either way.

Docker Desktop does not pass the event for a new file into the container, so
`scripts/dev-route-watch.mjs` restarts the dev server when a route file comes
or goes; a new route answers within about 10 seconds. An edit made in the
second of that restart can be missed: save the file again. If a new route
still answers 404, run `docker compose restart app`; do not start a second
`next dev` beside it.

## Before you open a pull request

Run these. All of them must pass, because CI runs the same list.

```bash
npm run format     # Prettier writes the files
npm run lint       # ESLint
npm run typecheck  # the app and the specs
npm test           # unit, route and component tests
npm run test:e2e   # Playwright
```

[docs/testing.md](docs/testing.md) says where a new test belongs: a unit, a
component, a route or an end to end test. A component test runs in Chromium,
so `npm test` needs the browser Playwright installs.

Playwright runs four files at once, each in order. The specs that listen on
the one test SMTP port run one at a time, in the `mail` project of
`playwright.config.ts`; a new spec that shares state with another file goes
there too.

About thirty tests carry the tag `@smoke`: one or two per main flow, each the
test that walks the flow end to end. They answer "is anything big broken?" in
about a minute, so run them after each change, with the specs you touched:

```bash
npx playwright test --grep @smoke
```

The whole suite still runs before a push. A smoke test must pass against the
dev server on 3050, so none of them reads mail, a webhook or an upload. Tag a
new one only when it walks a main flow that has none.

The end-to-end tests need a server. Start the dev one with `docker compose up`,
or let Playwright start one for you. On CI, and whenever `CI` is set, Playwright
runs `npm run start` instead, so the tests exercise what the image ships.

`npm run start` is the production build: `node .next/standalone/server.js`, the
same server the image runs. `PORT` picks the port, and it binds `0.0.0.0`
unless `HOST` names another address. It carries the copy of `.env` the build
made, not the file on disk, so anything you changed since then — or never had —
has to come from the command line. Build first, then start it on a free port
and point the tests at it:

```sh
npm run build
DATABASE_URL=postgres://ushabti:ushabti@localhost:5435/ushabti PORT=3101 npm run start
BASE_URL=http://localhost:3101 npm run test:e2e
```

Point the tests at `localhost` and never at a bare IP, because the session
cookie of a production build is `Secure` and Playwright's request context will
not send a `Secure` cookie to an IP address. `playwright.config.ts` refuses
such a `BASE_URL` and says the same thing.

Set `CI` as well and Playwright starts that same server for you, on `PORT`.
It builds `http://localhost:` and the port itself, so this recipe needs no
`BASE_URL`.
`DATABASE_URL` belongs on this one too, because the server it starts is the
standalone one and reads the `.env` the build copied rather than the file on
disk. Without it every route answers 500 and Playwright only says it timed
out:

```sh
CI=1 PORT=3101 DATABASE_URL=postgres://ushabti:ushabti@localhost:5435/ushabti npm run test:e2e
```

`npm run start` binds `0.0.0.0` because the image does, and because a shell
that exports `HOSTNAME` — `docker exec` does, and so do some Linux profiles —
would otherwise hand the server the machine's own name to bind, and
`localhost` would refuse. Use `HOST` when you mean a different address:
`HOST=127.0.0.1 PORT=3101 npm run start`. That is the address the server
listens on; `BASE_URL` still says `localhost`.

## Rules for a change

- **Keep properties dynamic.** No field on a task is hardcoded — not Status, not
  Priority. A change that adds a fixed field works against the idea of the
  product. Add a property type instead.
- **Add a test.** A new rule in `src/lib` needs a unit test. A new screen or
  interaction needs a Playwright test in `e2e/`.
- **Keep the interface quiet.** The board has no dialogs. Fields edit in place,
  and they save on blur. When something destroys data, do not add a dialog: use
  `ConfirmRow`, which turns the row itself into the question and names what is
  lost. "Delete Labels? 5 options and 14 values go with it." beats "Are you
  sure?" every time.
- **Off the board, use `components/ui/`.** Button, Input, Field, Card, Tag,
  Toasts, EmptyState, ConfirmRow, CopyField. Do not declare a fourth button.
  Geometry, radius and type come from the tokens at the top of `globals.css`.
- **Write plain English** in the interface and in comments. Short sentences.
- **Add a line to [CHANGELOG.md](CHANGELOG.md)** under "Unreleased" if a user
  would notice the change. When "Unreleased" already has the heading you need,
  such as `### Fixed`, add your entry under it. Never add a second copy of a
  heading: `.gitattributes` merges this file by union, so two branches that add
  entries under one heading meet without a conflict.

## If you change the database

1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate`. This writes a new file in `drizzle/`.
3. Commit that file with your change.

The dev container uses `drizzle-kit push`, so your local database follows the
schema immediately. A migration file is still necessary, because self-hosted
installs upgrade with `npm run db:migrate`.

A pushed database has no rows in `drizzle.__drizzle_migrations`, so
`db:migrate` replays `0000_init.sql` on it and fails on tables that exist. To
try a new migration file on the dev database before it ships, mark the pushed
database as migrated first. Do these steps in place of steps 1 and 2 above:

1. With the app container running and before you edit the schema, run
   `docker compose exec app npm run db:baseline`. It marks every file in
   `drizzle/meta/_journal.json` as applied and changes no schema. A second run
   changes nothing.
2. Edit `src/db/schema.ts` and run `npm run db:generate`.
3. Run `docker compose exec app npm run db:migrate`. It applies only the new
   file and ends with "migrations applied".

Do not restart the app container between the steps: it pushes the schema as
it starts, and then the new file fails on what push made. If you ran
`db:baseline` after `db:generate`, it marked the new file as applied too. To
go back, remove those marks with
`docker compose exec db psql -U ushabti -c 'DROP SCHEMA drizzle CASCADE'`,
remove the new file with its journal entry, and start again at step 1. Never
run `db:baseline` on a database that push did not build: it would skip
migrations that never ran.

## Style

- TypeScript, strict mode. ESLint refuses `any`.
- Prettier decides the formatting. Do not argue with it; run `npm run format`.
- CSS modules. No CSS framework.
- Comments explain **why**, not what.
- Small commits with a clear subject line.

## Where things are

```
src/app/            routes: pages and the JSON API
src/components/     the board, the settings, shared interface parts
src/db/             schema, client, seed
src/lib/            auth, ranks, grouping, value rules, events
e2e/                Playwright specs
drizzle/            generated migrations
```

## Branches

There is one branch: `main`. There is no `develop` and there is no release
branch. A release is only an annotated tag on a `main` commit.

A release branch exists to fix an old version while `main` already holds
breaking changes. Ushabti supports one version at a time, so a release branch
would add work and give nothing back. If that ever changes, `release/X.Y` will
be cut from the tag.

`main` is protected. Every change arrives through a pull request, and the
tests must pass before it merges.

## What runs, and when

| When               | What runs                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Pull request       | Format, lint, types, unit tests, build, migrations, Playwright. The image is built, but only for amd64 and it is never pushed. |
| Merge into `main`  | The same test job once, to prove the squashed commit still builds. Then CodeQL. No image.                                      |
| Pull request close | The caches that pull request wrote, deleted.                                                                                   |
| Every night        | The `:edge` image for amd64 and arm64, if `main` moved.                                                                        |
| Every Sunday       | Old caches and container versions no tag can reach, deleted.                                                                   |
| Every Monday       | CodeQL over `main`, to catch what a new query finds in old code.                                                               |
| Tag `vX.Y.Z`       | The release image for amd64 and arm64, its provenance attestation, and the GitHub release.                                     |

The rule behind the table: a pull request pays for correctness, a tag pays for
publishing, and a merge pays for almost nothing, because the commits it carries
passed minutes earlier. CodeQL sits on the merge rather than on the pull
request. It takes about seventy seconds and has never held a change back, so
making every pull request wait for it bought nothing.

Each architecture of the image builds on a runner of its own architecture. Do
not put them back on one runner: arm64 under emulation took nine minutes where
the pair now takes under three.

## Making a release

Versions follow [semantic versioning](https://semver.org/). Until 1.0.0 a minor
bump may break something.

1. Move the entries under "Unreleased" in `CHANGELOG.md` into a new
   `## X.Y.Z — YYYY-MM-DD` heading.
2. Set the same number in `package.json`.
3. Commit both.
4. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
5. After the release, check every branch rebased across it. Its changelog entry
   must sit under "Unreleased", not under the new version. The changelog
   merges by union, which never reports a conflict, so an entry can land under
   the new heading in silence.

The tag does the rest. It refuses to release if the tag, `package.json` and the
changelog disagree. When they agree it publishes:

- `jaklimoff/ushabti:X.Y.Z`, `:X.Y`, `:X` and `:latest` on Docker Hub and on
  `ghcr.io`, for amd64 and arm64
- a GitHub release whose notes are that section of the changelog

`:edge` is built once a night from `main`, and only if `main` moved. It is the
newest code, not a release. Use it to try something before it ships; do not
run it in production. `docker.yml` also has a manual trigger if you need an
`:edge` image sooner.

## Licence of your work

You agree that your work goes into Ushabti under the MIT licence.
