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

The app is then at <http://localhost:3000>.

## Before you open a pull request

Run these. All of them must pass, because CI runs the same list.

```bash
npm run format     # Prettier writes the files
npm run lint       # ESLint
npm run typecheck  # the app and the specs
npm test           # unit tests
npm run test:e2e   # Playwright
```

The end-to-end tests need a server. Start the dev one with `docker compose up`,
or let Playwright start one for you. On CI, and whenever `CI` is set, Playwright
serves the production build instead, so the tests exercise what the image
ships.

## Rules for a change

- **Keep properties dynamic.** No field on a task is hardcoded — not Status, not
  Priority. A change that adds a fixed field works against the idea of the
  product. Add a property type instead.
- **Add a test.** A new rule in `src/lib` needs a unit test. A new screen or
  interaction needs a Playwright test in `e2e/`.
- **Keep the interface quiet.** The board has no dialogs. Fields edit in place.
- **Write plain English** in the interface and in comments. Short sentences.
- **Add a line to [CHANGELOG.md](CHANGELOG.md)** under "Unreleased" if a user
  would notice the change.

## If you change the database

1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate`. This writes a new file in `drizzle/`.
3. Commit that file with your change.

The dev container uses `drizzle-kit push`, so your local database follows the
schema immediately. A migration file is still necessary, because self-hosted
installs upgrade with `npm run db:migrate`.

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
