#!/bin/sh
# The deploy of the release (USH-311). The tag starts docker.yml on GitHub, so
# the image is not there yet when this starts. It waits for the image, then
# writes the version into apps/ushabti/versions.env of the private
# jaklimoff/infra repo and pushes; that repo's deploy-ushabti workflow backs the
# database up and rolls out, and this waits for its result. Nothing here holds
# a cluster credential.
set -eu

# A launchd process has no login shell, so Homebrew is not on its PATH.
PATH="/opt/homebrew/bin:/opt/homebrew/opt/libpq/bin:$PATH"
export PATH

V="${SETMAAT_RELEASE_VERSION:?SETMAAT_RELEASE_VERSION is not set}"
image="jaklimoff/ushabti"
# 45 minutes by default; RELEASE_IMAGE_WAIT cuts it, to try the script.
wait_for="${RELEASE_IMAGE_WAIT:-2700}"
every=30

# A clone of jaklimoff/infra, pushed to with this machine's gh login.
infra="${USHABTI_INFRA:-$HOME/Projects/own/infra}"
if [ ! -d "$infra/.git" ]; then
  echo "deploy.sh: $infra is not a clone of jaklimoff/infra (gh repo clone jaklimoff/infra $infra). Nothing was done." >&2
  exit 1
fi

# The same URL as _require-tag in jaklimoff/infra's apps/ushabti/justfile.
url="https://hub.docker.com/v2/repositories/$image/tags/$V"
echo "deploy.sh: waiting for $image:$V on Docker Hub, at most ${wait_for}s"
waited=0
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)
  [ "$code" = "200" ] && break
  if [ "$waited" -ge "$wait_for" ]; then
    echo "deploy.sh: $image:$V is still not on Docker Hub after ${waited}s (HTTP $code). Look at docker.yml on GitHub. Nothing was deployed." >&2
    exit 1
  fi
  step=$every
  [ $((waited + step)) -gt "$wait_for" ] && step=$((wait_for - waited))
  sleep "$step"
  waited=$((waited + step))
done
echo "deploy.sh: $image:$V is on Docker Hub"

cd "$infra"
if [ -n "$(git status --porcelain)" ]; then
  echo "deploy.sh: $infra has uncommitted changes; a person is working there. Nothing was done." >&2
  exit 1
fi
file=apps/ushabti/versions.env
# Three tries: the Cards and Board app repos' CI push to jaklimoff/infra too,
# and one that lands between the pull and the push here gets this push
# rejected as non-fast-forward. Drop this commit, pull the newer main and
# write the version again, rather than fail a release whose image is out.
sha=""
attempt=1
while :; do
  git pull --ff-only --quiet
  perl -pi -e "s/^USHABTI_VERSION=.*/USHABTI_VERSION=$V/" "$file"
  if git diff --quiet -- "$file"; then
    echo "deploy.sh: $file already names $V; running its workflow again"
    gh workflow run deploy-ushabti.yml --repo jaklimoff/infra
    break
  fi
  git commit --quiet -m "deploy ushabti $V" -- "$file"
  if git push --quiet; then
    sha=$(git rev-parse HEAD)
    echo "deploy.sh: pushed $file at $V (${sha%"${sha#???????}"})"
    break
  fi
  # Only this script's own commit goes: the clean-tree check above and the
  # --ff-only pull mean HEAD~1 is what origin had.
  git reset --quiet --hard HEAD~1
  if [ "$attempt" -ge 3 ]; then
    echo "deploy.sh: $file could not be pushed in 3 tries. Nothing was deployed; 'just ushabti deploy $V' in jaklimoff/infra finishes it." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "deploy.sh: the push was rejected; trying again ($attempt of 3)"
done

# The run for that push, or the newest one when it was dispatched. GitHub
# takes a few seconds to list it.
run=""
tries=0
while [ -z "$run" ] && [ "$tries" -lt 24 ]; do
  sleep 5
  tries=$((tries + 1))
  if [ -n "$sha" ]; then
    run=$(gh run list --repo jaklimoff/infra --workflow deploy-ushabti.yml --commit "$sha" \
      --json databaseId --jq '.[0].databaseId // empty')
  else
    run=$(gh run list --repo jaklimoff/infra --workflow deploy-ushabti.yml --event workflow_dispatch \
      --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  fi
done
if [ -z "$run" ]; then
  echo "deploy.sh: no deploy-ushabti run appeared for $V in two minutes. Look at jaklimoff/infra's Actions." >&2
  exit 1
fi
echo "deploy.sh: waiting for https://github.com/jaklimoff/infra/actions/runs/$run"
if ! gh run watch "$run" --repo jaklimoff/infra --exit-status >/dev/null; then
  echo "deploy.sh: the deploy of $V failed: https://github.com/jaklimoff/infra/actions/runs/$run" >&2
  exit 1
fi
echo "deploy.sh: $V is deployed"
