# Webhooks

A webhook is a call out of the board, for a service that cannot hold a socket
open. An agent listens on the stream — `board.mjs watch` does it for you — but
a serverless function, a CI job or a chat bot has nowhere to listen from. It
gives Ushabti a URL instead, and Ushabti posts to it.

What arrives is the same doorbell the stream rings: **that** something changed
and **where**, never what. The receiver then reads the board, exactly as an
agent on the stream does. There is no title in the body, no value, and no
before and after.

## Make one

**Settings → Webhooks**, at `/p/{projectId}/settings/webhooks`. Only the owner
of the project sees the page, and only the owner can call any of its routes —
the read one too. A URL and a secret are another road onto the board.

1. Type the URL and press **Add webhook**.
2. Copy the secret. It is shown once. The server keeps it whole, because it
   signs every body with it, but nothing shows it again: after this the page
   shows a prefix and **Roll the secret**.
3. Press **Send a test**. The row says _delivered 2s ago_, or _failed 4s ago —
   ECONNREFUSED_.

A row holds the URL, the kinds it rings for, and on or off. The URL saves when
you leave the box. Delete asks in its own row first.

**Which kinds.** The words are the ones the activity feed writes: `created`,
`title`, `description`, `value`, `checklist`, `comment`, `run`, `archive`,
`deleted`, `reset`. Pick none and it rings for every one of them. A change that
writes no feed line — a view, a property, the card view — rings nothing.

**`deleted` rings both ways.** A delete can be undone for thirty days, so the
word covers a task going and a task coming back. The doorbell says only that
something happened, as always; the feed line it rang about carries
`data.action`, which is `deleted` or `restored`. A receiver that treated every
`deleted` ring as a task going away has to read the action now. The line has no
task id either way — `activity.task_id` cascades, so a line naming the task
would be swept away with it — and carries `data.key` instead.

## The payload

```json
{
  "delivery": "9d2d9d6e-9a6f-4f63-9b1e-6b2b0b6a4c11",
  "projectId": "2f1a7c2e-5f0c-4d4a-9a2e-2b9a3c4d5e6f",
  "projectKey": "USH",
  "kind": "comment",
  "taskId": "7c1b9a2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d",
  "taskKey": "USH-31",
  "at": "2026-03-17T09:46:40.000Z"
}
```

`taskId` and `taskKey` are **null** on a line about the project rather than
about a task — `reset` is one of those — so do not read a key off every body.
**Send a test** carries `kind: "test"` and no task at all: it is the one body
that names no feed line, because there is none.

`at` is exactly the moment on the activity row, so
`GET /api/projects/{projectId}/activity?after=<at minus a second>` lands on the
line that rang. `delivery` is the id of this delivery: a retry carries the same
one, so a receiver that keeps the ids it has seen never acts twice.

## The headers

| Header | What it is |
| --- | --- |
| `X-Ushabti-Delivery` | The delivery id, which is also in the body |
| `X-Ushabti-Timestamp` | When the body was signed, in seconds |
| `X-Ushabti-Signature` | `sha256=<hex>` — see below |
| `Content-Type` | `application/json` |

## Verifying, in ten lines of Node

The string signed is `timestamp + "." + body`, over the **raw** body, before
any JSON parsing. HMAC-SHA256 with the secret. Compare in constant time, and
refuse a timestamp older than five minutes: that is what stops somebody
replaying a body they captured.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, headers, rawBody) {
  const time = headers["x-ushabti-timestamp"];
  const given = Buffer.from(headers["x-ushabti-signature"] ?? "");
  if (!time || Math.abs(Date.now() / 1000 - Number(time)) > 300) return false;
  const want = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(`${time}.${rawBody}`).digest("hex"),
  );
  return want.length === given.length && timingSafeEqual(want, given);
}
```

A known answer, so you can check your code before you trust a delivery:

```text
secret     ushs_a-known-secret-for-the-test
timestamp  1774000000
body       {"delivery":"9d2d9d6e-9a6f-4f63-9b1e-6b2b0b6a4c11","projectId":"2f1a7c2e-5f0c-4d4a-9a2e-2b9a3c4d5e6f","projectKey":"USH","kind":"comment","taskId":"7c1b9a2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d","taskKey":"USH-31","at":"2026-03-17T09:46:40.000Z"}
signature  sha256=861a870d23c4a8089c8af6c498dd30e1bafb67b299080feb2ec792de5088f70d
```

## Which addresses are allowed

A webhook is the one place where a person tells the server to make a request
for them, so the address has to be one a stranger could reach too. Ushabti
refuses, at the moment it is saved and again before every try:

- a **loopback** address — `127.0.0.0/8`, `0.0.0.0/8`, `::1`, and `localhost`
  by any of its names;
- a **private** address — `10/8`, `172.16/12`, `192.168/16`, `fc00::/7`;
- a **link-local** address — `169.254.0.0/16`, which is where a cloud keeps
  its metadata service, and `fe80::/10`;
- a URL with a **name and password** in it, which goes to whoever answers and
  hides the real host — `http://example.com@169.254.169.254/` is not a call to
  example.com.

A redirect is a failure too (`redirect: "error"`), so point the webhook at the
address it ends up at. A name is resolved before each try, so a host that
answers publicly today and points inside tomorrow is refused then rather than
called.

**If your receiver really is on that network**, set `USHABTI_WEBHOOK_PRIVATE=1`
in the server's environment and those addresses are allowed. It is off by
default on purpose: a self-hoster should say so once, deliberately, rather than
find out by accident. The two rules above it — the scheme, and no credentials
— hold whatever the flag says.

The refusal is a plain sentence in the row, beside the box that holds the URL.

## Delivery

The first try goes at once. A try that fails is made again after **1 minute**,
then **5 minutes**, then **30 minutes** — four tries in all. A try waits **5
seconds** for an answer and no longer. Anything outside `2xx` is a failure, and
so is a redirect: point the webhook at the address it ends up at.

Nothing about this is on the path of a write. A change writes its activity row
and one queued row per webhook, and returns; the sender drains the queue in the
background and again whenever somebody reads the board. **A dead endpoint costs
one INSERT** and slows nobody down.

After four failures the delivery is dropped. It is old news by then, and the
way to catch up is the feed, which is the record:

```bash
curl -s "$USHABTI_URL/api/projects/$PROJECT/activity?after=$CURSOR" \
  -H "Authorization: Bearer $TOKEN"
```

The last **20** deliveries of each webhook are kept, and the page reads the
newest of them for its line. Older ones are dropped as new ones arrive.

## Rolling the secret

**Roll the secret** answers a new one, once, and every body from that moment is
signed with it. A receiver that has not been told the new secret starts
refusing deliveries — which is what rolling a secret is for. There is no
overlap and no second secret.

## The routes

All four are `ownerOnly`, and a token is refused: a webhook is structure, and
structure is the owner's.

| What | Call |
| --- | --- |
| The list, with each one's last delivery | `GET /api/projects/{projectId}/webhooks` |
| Make one, and read its secret once | `POST /api/projects/{projectId}/webhooks` |
| URL, kinds, on or off, or `{"roll": true}` | `PATCH /api/projects/{projectId}/webhooks/{id}` |
| Send a test | `POST /api/projects/{projectId}/webhooks/{id}` |
| Delete it | `DELETE /api/projects/{projectId}/webhooks/{id}` |

## What a receiver should do

1. Check the signature, and refuse anything that fails. Answer `401`.
2. Answer **fast** — `200` and nothing else. Do the work afterwards. Five
   seconds is all the sender waits.
3. Keep the delivery ids you have seen and skip a repeat.
4. Read `/activity?after=…` for what actually happened, a few seconds before
   your cursor, and skip the entries you have already handled: two writes can
   commit out of the order of their clocks.
