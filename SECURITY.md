# Security

## Report a weakness

Do not open a public issue for a security problem.

Use **Report a vulnerability** on the Security tab of the repository on GitHub.
This opens a private advisory that only the maintainers can read.

Tell us:

- what the problem is,
- how to cause it,
- what an attacker gets from it.

You get an answer in seven days. Please give us 90 days before you make the
problem public.

## Versions

Ushabti is at version 0.x. Only the newest commit on `main` gets a fix.

## What you must know before you make it public

Ushabti is honest about its limits. These are known and are not weaknesses to
report:

- **The rate limit is one process deep.** Ten failed sign-ins, sign-ups, agent
  tokens or reset links in ten minutes are answered `429`, counted per address
  and, for sign-in, per email. The count is held in memory, so a restart forgets it and
  a second process counts separately. It slows a guess; it does not stop a
  botnet. Put Ushabti behind a proxy that limits requests as well.
- **One address is often many people.** Behind one NAT — an office, a VPN, a
  school — everybody shares the address, so ten failures from one desk block
  sign-in, sign-up, agent tokens and reset links for all of them for ten
  minutes. A sign-in that works clears the count for that email and not for
  the address.
- **The address comes from `x-forwarded-for`.** Ushabti believes it, because
  in production a proxy writes it. Make that proxy replace the header rather
  than add to it, or a caller names its own address and the limit means
  nothing.
- **The address in a reset link and an invite comes from `x-forwarded-host`.**
  The same trust, and the same instruction: have the proxy **replace** that
  header as well. A caller that names the host writes the address the owner
  copies out of the page — and, with mail on, the address the server itself
  emails from `MAIL_FROM` — and the token in a reset link is real.
- **A password reset is a person, or a form that emails.** With `SMTP_URL`,
  `MAIL_FROM` and `USHABTI_URL` set, **Forgot password?** emails a one-time link
  to the account's own address. The link is built from `USHABTI_URL` and never
  from the request's `Host`, which anybody can forge; the answer is one
  sentence for every email and goes out before the email is looked up. Without
  them there is no such page. The owner or an admin of a project makes a member a one-time
  link, good for 24 hours; the token is stored as a SHA-256 digest and using it
  ends every session that account had. With `SMTP_URL` and `MAIL_FROM` set, the
  server emails that link to the member's address, so that mailbox is as good
  as the password until the link is spent. An `smtp://` server must offer
  STARTTLS, or the send fails, so the link and the SMTP password never cross
  the network in clear text; only a relay on localhost is let off. Without them, the owner sends it by
  hand. Whoever can read that link can take the account, so send it the way you
  would send a password.
- **With mail on, an open board lets a stranger make it send email.** Anybody
  who can sign up can make a project and invite any address, and the invite
  carries the project's name and their own, which they chose. Every email the
  server sends spends one of ten tries per ten minutes, counted per account and
  per calling address, and a refused send is written as "Could not email". That
  slows a relay; it does not stop one made of many addresses. Close sign-up
  (`USHABTI_SIGNUP=closed`) once your team is in, before you set `SMTP_URL`.
- **Every member of a project sees everything in it.** There are no per-field or
  per-task permissions.
- **The session cookie is marked `secure` in production.** Serve the app over
  HTTPS, or a browser will not send the cookie back.

Do not put Ushabti on the open internet without a reverse proxy with TLS.
