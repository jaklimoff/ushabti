#!/bin/sh
# Local only. The loop's check for one task (the owner, 2026-10-08): the fast
# checks, then the @smoke tests and every spec the task changed, against the
# dev server on :3050, which serves this checkout. Under five minutes is the
# goal; the whole suite runs once per batch, before the push (.setmaat/e2e.sh),
# and for a task that changed the harness of the specs.
# nice, because other projects' agents share this Mac.
set -eu
cd "$(dirname "$0")/.."

npm run format:check
npm run lint
npm run typecheck
npm test

# What the task changed: its commits since main, edits not committed yet, and
# new files. The base is the local main, which runs ahead of origin in a batch.
base=$(git merge-base main HEAD)
changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)

# A change to the harness of the specs can break any of them, so all of them,
# the CI way (USH-310): every spec against the dev server crashes it, and the
# webhook specs fail there whatever the change. e2e.sh takes the lock itself.
if printf "%s\n" "$changed" | grep -qE '^(e2e/helpers\.ts|src/test/fixtures|playwright\.config\.ts)'; then
  echo "check: the e2e harness changed, so every spec, the CI way (.setmaat/e2e.sh)"
  start=$(date +%s)
  status=0
  sh .setmaat/e2e.sh || status=$?
  echo "check: e2e.sh took $(($(date +%s) - start))s"
  exit "$status"
fi

# One end to end run on this Mac at a time. Not exec: the trap must still run
# to give the lock back.
. .setmaat/lock.sh
trap e2e_unlock EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
e2e_lock "check.sh $(git rev-parse --abbrev-ref HEAD)"

# One run: Playwright's --grep reads the file name too, so a spec the task
# changed joins the smoke tests by its name.
grep='@smoke'
for f in $(printf "%s\n" "$changed" | grep -E '^e2e/.*\.spec\.ts$' || true); do
  [ -f "$f" ] && grep="$grep|$(basename "$f" | sed 's/\./\\./g')"
done
echo "check: e2e --grep \"$grep\""
nice -n 10 npx playwright test --workers=4 --grep "$grep"
