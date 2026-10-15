#!/bin/sh
# The ship of the release on the board (USH-321), as release.after. It runs
# after the tasks moved to Shipped, because the board's Ship archives only what
# is over, and at the deploy they were still in Ready. Shipping the option is
# what gives the changelog its entry. --strays takes the released tasks that
# nobody put in the release, so setting Release ahead stays optional.
set -eu

# A launchd process has no login shell, so Homebrew is not on its PATH.
PATH="/opt/homebrew/bin:$PATH"
export PATH

V="${SETMAAT_RELEASE_VERSION:?SETMAAT_RELEASE_VERSION is not set}"

if [ -z "${USHABTI_TOKEN:-}" ]; then
  echo "ship.sh: USHABTI_TOKEN is not set, so $V was not shipped on the board." >&2
  exit 1
fi
if [ -z "${USHABTI_URL:-}" ]; then
  echo "ship.sh: USHABTI_URL is not set, so $V was not shipped on the board." >&2
  exit 1
fi

board="$(cd "$(dirname "$0")/../.." && pwd)/examples/skill/ushabti/board.mjs"
today=$(date +%F)
why=$(mktemp)
trap 'rm -f "$why"' EXIT

# board.mjs prints its own reason on stderr; this says it once, in one line.
run() {
  what=$1
  shift
  if ! node "$board" "$@" 2>"$why"; then
    echo "ship.sh: the board refused to $what $V ($(tr '\n' ' ' <"$why" | sed 's/ *$//')), and nothing before this step is undone." >&2
    exit 1
  fi
}

run date release "$V" --target "$today"
run ship ship "$V" --rest leave --strays
