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

### `SMTP_URL` and `MAIL_FROM`

Set both to let the server email an [invite](/ushabti/guides/people/#adding-somebody) and a
[reset link](/ushabti/guides/people/#a-forgotten-password). Leave both unset and nothing is ever
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
sign-in page offers [**Forgot password?**](/ushabti/guides/people/#forgot-password), which emails a
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
`USHABTI_URL` an [agent](/ushabti/agents/connect/) uses to find the board.

## What is not configurable

Worth stating plainly, so you do not go looking:

- **The rate limit** is ten failures in ten minutes, per key, and there is no variable for either
  number. The keys are the address for sign-in, sign-up, agent tokens, reset links and forgot
  requests, and the email address for sign-in and for a forgot request. A forgot request counts
  every time, whether or not an account uses the email. A sign-in that works counts nothing and clears the count for that email. Over the limit
  the answer is `429` with `Retry-After`. The count is held in the memory of one process, so a
  restart forgets it and a second process counts separately — see
  [Host it for your team](/ushabti/start/self-host/).
- **Session length** is 30 days. The cookie is `ushabti_session`, `httpOnly`, `SameSite=Lax`.
- **The colour palette** is twelve fixed colours for options and eight for avatars. A board where
  anybody can pick any colour stops meaning anything.
- **The run lease** is 30 minutes without a report, or longer when a report said so with `reportFor`, up to 60 minutes; a run reads *quiet* after 6 minutes.
- **Mail carries four things and nothing else**: an invite to an email with no account, a reset
  link to the member it was made for, a reset link a person asked for with **Forgot password?**,
  and one email about a question an agent asked that nobody answered for 15 minutes — and only
  with [`SMTP_URL`](#smtp_url-and-mail_from) set, and for the last two
  [`USHABTI_URL`](#ushabti_url) as well. A question is emailed once, never again, to the person
  the task is assigned to, else the last person who changed it, else the owners and admins. Anybody
  can turn those emails off on their account page. There are no other notifications. See [A
  forgotten password](/ushabti/guides/people/#a-forgotten-password).
- **The life of a reset link** is 24 hours and one use.
