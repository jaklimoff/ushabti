---
title: Configuration
description: Every environment variable Ushabti reads, what it does, and what happens when you leave it alone.
sidebar:
  order: 5
---

Ushabti is configured entirely by environment variables. There is no configuration file and no
settings a server administrator edits at runtime.

## The ones you might set

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

Live updates take **one more on top, per process**: each Ushabti process holds one `LISTEN`
connection outside the pool, however many boards and tabs are open. Lower this on a shared managed
cluster.

### `DATABASE_DIRECT_URL`

A direct connection to the same database as `DATABASE_URL`. **Default: unset**, and an empty value
counts as unset.

Set it when `DATABASE_URL` points at a connection pooler in transaction mode, such as PgBouncer or
DigitalOcean's pool. `LISTEN` needs a session of its own, which such a pooler does not keep, so live
updates would go quiet with no error. With this set, the live-updates `LISTEN` connection and the
migrations in `scripts/migrate.mjs` and `scripts/baseline.mjs` use it, and every query still goes
through `DATABASE_URL`. Unset, everything uses `DATABASE_URL`.

```bash
DATABASE_URL=postgres://user:pass@pool-host:25061/ushabti-pool
DATABASE_DIRECT_URL=postgres://user:pass@db-host:25060/ushabti
```

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

Set to `1` — and only that — to let a [webhook](/api/webhooks/) be pointed at a **private,
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
| `USHABTI_VERSION`         | `latest`             | The image tag `docker-compose.prod.yml` pulls. Pin a release here.     |
| `NODE_ENV`                | set by the image     | `production` marks the session cookie `secure`, so plain HTTP breaks sign-in. |
| `PORT` / `HOSTNAME`       | `3000` / `0.0.0.0`   | Baked into the production image.                                       |
| `NEXT_TELEMETRY_DISABLED` | `1` in both images   | Next.js telemetry is off.                                              |
| `CI`                      | unset                | When set, Playwright serves the **production build** instead of the dev server. |
| `NEXT_PHASE` / `NEXT_RUNTIME` | set by Next.js   | Never set these. The build reads no `DATABASE_URL`; instrumentation runs only in Node. |

### Files on a task: `S3_*` and `ATTACHMENT_*`

A task holds files, images and video first, in an S3-compatible bucket: DigitalOcean Spaces, AWS
S3, RustFS or any other. Leave `S3_BUCKET` unset and attachments are off: every attachment route
answers 503, and **Settings → Project** says what to set. A bucket without both keys keeps them off,
and the server logs one line at start that says why.

| Variable               | Default            | What it does                                                    |
| ---------------------- | ------------------ | --------------------------------------------------------------- |
| `S3_ENDPOINT`          | empty              | The bucket's server. Empty for AWS.                             |
| `S3_REGION`            | `us-east-1`        | The region.                                                     |
| `S3_BUCKET`            | unset              | The bucket. Without it, attachments are off.                    |
| `S3_ACCESS_KEY`        | unset              | The key that may put, read and delete in the bucket.            |
| `S3_SECRET_KEY`        | unset              | Its secret.                                                     |
| `S3_FORCE_PATH_STYLE`  | off                | `true`, `1` or `yes` for RustFS and other path-style stores.    |
| `ATTACHMENT_MAX_BYTES` | `52428800` (50 MiB) | The largest file, in bytes.                                    |
| `ATTACHMENT_MIMES`     | images and video   | The types a task takes, comma separated.                        |

The bucket stays private. A file is read only through `/api/attachments/{id}`, which checks that the
reader is on the project and redirects to a link that lasts five minutes. A browser uploads straight
to the bucket, so give the bucket a CORS rule that allows `PUT` from the board's address. SVG and
anything that is not an image or a video always downloads, because SVG carries script.

### Only for development

| Variable              | Default | What it does                                                                                   |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `ALLOWED_DEV_ORIGINS` | unset   | Host names, comma separated, that `next dev` lets load its client, such as `devbox.local`. Without it, a dev server opened by another name never hydrates. |
| `DEV_SERVER_PAUSE_MS` | `2000`  | How long `scripts/dev-server.mjs` waits before it starts `next dev` again after a crash.       |

### `SMTP_URL` and `MAIL_FROM`

Set both to let the server email an [invite](/guides/people/#adding-somebody) and a
[reset link](/guides/people/#a-forgotten-password). Leave both unset and nothing is ever
emailed: every screen and every answer is as it was before there was any mail, and the owner sends
the link by hand.

```bash
SMTP_URL=smtps://user:password@smtp.example.com:465
MAIL_FROM="Ushabti <board@example.com>"
```

`SMTP_URL` is where the mail goes: `smtps://` for TLS from the first byte (usually port 465), or
`smtp://` for a server that upgrades with STARTTLS (usually 587). An `smtp://` server has to offer
STARTTLS, or the send fails rather than put the password and the link on the wire in clear text; only
a relay on the same machine (`localhost`, `127.0.0.1`, `::1`) may speak plain SMTP. Any provider that
speaks SMTP works.
Put the user name and the password in the URL, percent-encoded where they hold a `@` or a `:`.
`MAIL_FROM` is the sender every email carries, and your provider has to accept it.

One without the other leaves mail off, and the server logs one line at start that says which is
missing. The mail is plain text. Nothing is queued and nothing retries: the server sends after the
invite or the link is written, waits at most 10 seconds, and the page says whether it went. The link
stays on the page either way, because an email can still be lost.

Each email spends one of ten tries per ten minutes, counted per account and per calling address;
past that the invite or the link is still made, and the page says it could not email. With mail on,
anybody who can sign up can make the server send invites, so close sign-up
([`USHABTI_SIGNUP=closed`](#ushabti_signup)) once your team is in.

### `USHABTI_URL`

The address your team opens the board at, with the scheme and no path. With mail on as well, the
sign-in page offers [**Forgot password?**](/guides/people/#forgot-password), which emails a
person a link to set a new password.

```bash
USHABTI_URL=https://tasks.example.com
```

The link in that email is built from this address and never from the request. Anybody can send a
request with a forged `Host`, and the real person would then get a real email whose link carries a
live token to somebody else's site. A link an owner makes on the People page still takes the
address the owner's browser used.

With mail on and `USHABTI_URL` unset — or not starting with `http://` or `https://` — the forgot page
is off, and the server logs one line at start that says so, next to the mail line. It is the same
`USHABTI_URL` an [agent](/agents/connect/) uses to find the board.

## What is not configurable

Worth stating plainly, so you do not go looking:

- **The rate limit** is ten failures in ten minutes, per key, and there is no variable for either
  number. The keys are the address for sign-in, sign-up, agent tokens, reset links and forgot
  requests, and the email address for sign-in and for a forgot request. A forgot request counts
  every time, whether or not an account uses the email. A sign-in that works counts nothing and clears the count for that email. Over the limit
  the answer is `429` with `Retry-After`. The count is held in the memory of one process, so a
  restart forgets it and a second process counts separately — see
  [Host it for your team](/start/self-host/).
- **Session length** is 30 days. The cookie is `ushabti_session`, `httpOnly`, `SameSite=Lax`.
- **The colour palette** is twelve fixed colours for options and eleven for avatars: the same twelve without the grey. A board where
  anybody can pick any colour stops meaning anything.
- **The run lease** is 30 minutes without a report, or longer when a report said so with `reportFor`, up to 60 minutes; a run reads *quiet* after 6 minutes.
- **Mail carries four things and nothing else**: an invite to an email with no account, a reset
  link to the member it was made for, a reset link a person asked for with **Forgot password?**,
  and one email about a question an agent asked that nobody answered for 15 minutes — and only
  with [`SMTP_URL`](#smtp_url-and-mail_from) set, and for the last two
  [`USHABTI_URL`](#ushabti_url) as well. A question is emailed once, never again, to the person
  the task is assigned to, else the last person who changed it, else the owners and admins. Anybody
  can turn those emails off on their account page. There are no other notifications. See [A
  forgotten password](/guides/people/#a-forgotten-password).
- **The life of a reset link** is 24 hours and one use.
