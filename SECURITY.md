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

- **No rate limit on sign-in.** Nothing slows down a password guessing attack.
  Put Ushabti behind a proxy that limits requests.
- **No password reset.** There is no email in the system.
- **Every member of a project sees everything in it.** There are no per-field or
  per-task permissions.
- **The session cookie is marked `secure` in production.** Serve the app over
  HTTPS, or a browser will not send the cookie back.

Do not put Ushabti on the open internet without a reverse proxy with TLS.
