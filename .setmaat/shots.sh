#!/bin/sh
# loop.review.shots: the screenshots of the specs that the task
# changed, from the last Playwright run (the check's), for the reviewer
# (USH-308). Playwright saves one at the end of every test; a spec whose end
# state is not the screen saves `seen-<name>.png` itself, and that one wins.
set -eu
cd "$(dirname "$0")/.."
out=${SETMAAT_SHOTS_DIR:?SETMAAT_SHOTS_DIR is not set}
max=8

# The specs the task changed, found as check.sh finds them.
base=$(git merge-base main HEAD)
specs=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u |
  grep -E '^e2e/[^/]+\.spec\.ts$' | sed 's#^e2e/##; s#\.spec\.ts$##' || true)
[ -n "$specs" ] && [ -d test-results ] || exit 0
mkdir -p "$out"

# No other end to end run rewrites test-results/ while it is copied (USH-310).
. .setmaat/lock.sh
trap e2e_unlock EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
e2e_lock "shots.sh"

# A folder is `<spec>-<test>-<project>`, so `board-` also starts every folder
# of board-list. The longest spec name that starts the folder owns it. Every
# spec name is short enough to survive Playwright's cut at 60 characters.
all=$(ls e2e | sed -n 's#\.spec\.ts$##p')
n=0
for dir in $(ls test-results); do
  [ "$n" -lt "$max" ] || break
  [ -d "test-results/$dir" ] || continue
  case $dir in *-retry[0-9]*) continue ;; esac
  owner=""
  for s in $all; do
    case $dir in "$s"-*) [ ${#s} -gt ${#owner} ] && owner=$s ;; esac
  done
  printf "%s\n" "$specs" | grep -qxF "$owner" || continue
  shot=$(ls "test-results/$dir"/seen-*.png 2>/dev/null | head -n 1 || true)
  [ -n "$shot" ] || shot=$(ls "test-results/$dir"/test-finished-*.png 2>/dev/null | head -n 1 || true)
  [ -n "$shot" ] || continue
  name=$(printf "%s\n" "$dir" | sed -E 's/-(chromium|mail)$//')
  cp "$shot" "$out/$name.png"
  n=$((n + 1))
done
echo "shots: $n"
