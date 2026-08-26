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

`/register` then says *"This board is closed — it is not taking new accounts. Ask whoever runs it to
make one for you."*, and `POST /api/auth/register` refuses with 403. Existing accounts are
unaffected, and the owner can still add members by email.

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

- **Session length** is 30 days. The cookie is `ushabti_session`, `httpOnly`, `SameSite=Lax`.
- **The colour palette** is twelve fixed colours for options and eight for avatars. A board where
  anybody can pick any colour stops meaning anything.
- **The run lease** is 30 minutes without a report; a run reads *quiet* after 6 minutes.
- **There is no SMTP setting**, because there is no email anywhere in the product — no invites, no
  password reset, no notifications.
