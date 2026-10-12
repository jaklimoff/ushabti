#!/bin/sh
# The deploy of the release (USH-311). The tag starts docker.yml on GitHub, so
# the image is not there yet when this starts; `just deploy` refuses a version
# Docker Hub does not have. It waits for the image, backs the database up, and
# deploys with the commands of infra/, which only this checkout has.
set -eu

# A launchd process has no login shell, so Homebrew is not on its PATH.
PATH="/opt/homebrew/bin:/opt/homebrew/opt/libpq/bin:$PATH"
export PATH

V="${SETMAAT_RELEASE_VERSION:?SETMAAT_RELEASE_VERSION is not set}"
image="jaklimoff/ushabti"
# 45 minutes by default; RELEASE_IMAGE_WAIT cuts it, to try the script.
wait_for="${RELEASE_IMAGE_WAIT:-2700}"
every=30

if [ ! -d infra ]; then
  echo "deploy.sh: infra/ is not in this checkout, so nothing can deploy. Nothing was done." >&2
  exit 1
fi

# The same URL as _require-tag in infra/justfile.
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

cd infra
echo "deploy.sh: just backup-push"
just backup-push
echo "deploy.sh: just deploy $V"
just deploy "$V"
echo "deploy.sh: just check"
just check
echo "deploy.sh: $V is deployed"
