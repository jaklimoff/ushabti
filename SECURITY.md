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
- **The address comes from `x-forwarded-for`.** Ushabti believes it, because
  in production a proxy writes it. Make that proxy replace the header rather
  than add to it, or a caller names its own address and the limit means
  nothing.
- **A password reset is a person, not an email.** There is no email in the
  system. The owner of a project makes a member a one-time link, good for 24
  hours, and sends it by hand; the token is stored as a SHA-256 digest and
  using it ends every session that account had. Whoever can read that link can
  take the account, so send it the way you would send a password.
- **Every member of a project sees everything in it.** There are no per-field or
  per-task permissions.
- **The session cookie is marked `secure` in production.** Serve the app over
  HTTPS, or a browser will not send the cookie back.

Do not put Ushabti on the open internet without a reverse proxy with TLS.
