# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the numbers follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.1.0 — 2026-08-22

The first release. Everything is new.

### Added

- Email and password sign-in. Projects with members, added by email.
- Custom properties: select, multi-select, person, text, number, date and
  checkbox. No field on a task is hardcoded, not even Status.
- Views. Each one is a board grouped by a select, person or checkbox property.
- Drag and drop for cards and for columns, with the pointer or the keyboard.
- Task detail: markdown description, checklist, comments and an activity log.
- Live updates over server-sent events.
- Docker Compose for development, a production image, and migrations that run
  when the container starts.
- 14 unit tests and 18 end-to-end tests.

### Known limits

Read the end of [ROADMAP.md](ROADMAP.md). The short list: one card order for all
views, no rate limit on sign-in, and no password reset.
