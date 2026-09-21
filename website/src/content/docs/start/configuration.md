---
title: Configuration
description: Every environment variable Ushabti reads, what it does, and what happens when you leave it alone.
sidebar:
  order: 5
---

Ushabti is configured entirely by environment variables. There is no configuration file and no
settings a server administrator edits at runtime.

## The four you might set

### `DATABASE_URL`

The database Ushabti talks to. **Required** — `scripts/migrate.mjs` exits 1 without it.

```bash
DATABASE_URL=postgres://ushabti:ushabti@localhost:5435/ushabti
```

That is the default in `.env.example` and the fallback in the code, matching the port
`docker-compose.yml` publishes. Inside the dev container the compose file overrides it to
`postgres://ushabti:ushabti@db:5432/ushabti`.

PostgreSQL 14 or later. The compose files pin 18, which is the version actually tested.

### `POSTGRES_PASSWORD`

Only read by `docker-compose.prod.yml`, where it becomes the database password and is interpolated
into `DATABASE_URL`. Compose refuses to start without it. Use a long random string:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
```

### `DATABASE_POOL_MAX`

How many Postgres connections one Ushabti process may hold. **Default 12.**

Live updates take **one more on top, per open board**: every server-sent-events stream holds a
`LISTEN` connection outside the pool. Lower this on a shared managed cluster.

### `USHABTI_SIGNUP`

Set to `closed` — case-insensitive, and only that literal word — to stop this instance taking new
accounts. Anything else, including unset, leaves sign-up open.

```bash
USHABTI_SIGNUP=closed
```

`/register` then says the board is closed and takes a new account only for an invited email, and
`POST /api/auth/register` refuses any other with 403. Existing accounts are unaffected. An owner
invites somebody by adding their email in **Settings → People**; that email may then sign up.

### `USHABTI_WEBHOOK_PRIVATE`

Set to `1` — and only that — to let a [webhook](/ushabti/api/webhooks/) be pointed at a **private,
loopback or link-local** address. Unset, which is the default, those are refused.

```bash
USHABTI_WEBHOOK_PRIVATE=1
```

A webhook is the one request a person tells the server to make for them. Left open, the settings
page becomes a way to read what else is reachable from the board: `http://169.254.169.254/…` is a
cloud's metadata service, and `http://127.0.0.1:5432/` says whether a database is listening. The
check runs when the URL is saved and again before every try, resolving the name each time, so a
public name that starts pointing inside is refused then.

Set it when your receiver really is on that network — an internal CI runner, a service on the same
compose network. `docker-compose.yml`, the development one, sets it already, because a developer's
receiver is on their own machine. `docker-compose.prod.yml` deliberately does not.

## Read, but rarely set

| Variable                  | Default              | What it does                                                          |
| ------------------------- | -------------------- | --------------------------------------------------------------------- |
| `USHABTI_VERSION`         | `edge`               | The image tag `docker-compose.prod.yml` pulls. Pin a release here.     |
| `NODE_ENV`                | set by the image     | `production` marks the session cookie `secure`, so plain HTTP breaks sign-in. |
| `PORT` / `HOSTNAME`       | `3000` / `0.0.0.0`   | Baked into the production image.                                       |
| `NEXT_TELEMETRY_DISABLED` | `1` in both images   | Next.js telemetry is off.                                              |
| `CI`                      | unset                | When set, Playwright serves the **production build** instead of the dev server. |

## What is not configurable

Worth stating plainly, so you do not go looking:

- **The rate limit** is ten failures in ten minutes, per key, and there is no variable for either
  number. The keys are the address for sign-in, sign-up, agent tokens and reset links, and the email
  address for sign-in. A sign-in that works counts nothing and clears the count for that email. Over the limit
  the answer is `429` with `Retry-After`. The count is held in the memory of one process, so a
  restart forgets it and a second process counts separately — see
  [Host it for your team](/ushabti/start/self-host/).
- **Session length** is 30 days. The cookie is `ushabti_session`, `httpOnly`, `SameSite=Lax`.
- **The colour palette** is twelve fixed colours for options and eight for avatars. A board where
  anybody can pick any colour stops meaning anything.
- **The run lease** is 30 minutes without a report, or longer when a report said so with `reportFor`, up to 60 minutes; a run reads *quiet* after 6 minutes.
- **There is no SMTP setting**, because there is no email anywhere in the product — no invites, no
  notifications, and no reset mail. A forgotten password is answered by the owner of a project, who
  makes a link and sends it by hand: [A forgotten
  password](/ushabti/guides/people/#a-forgotten-password).
- **The life of a reset link** is 24 hours and one use.
