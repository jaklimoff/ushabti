#!/bin/sh
# The end to end half of the loop's check: the CI way, on this Mac.
# The loop lands straight on main (the owner, 2026-10-07), so nothing red may
# reach it, and Playwright is what CI would have caught.
#
# A throwaway Postgres on a free port, never the dev database: the specs make
# users and projects by the hundred, and a branch's migration must not touch
# the database the Docker dev server serves. With CI set Playwright starts the
# standalone build itself, on this machine, so the webhook specs reach their
# receiver and the mail spec its SMTP. A throwaway RustFS, as CI has, for the
# upload spec.
set -eu

free() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"; }

name="ushabti-e2e-$$"

# One end to end run on this Mac at a time (USH-310), taken before the
# containers and the build, so a run that waits holds nothing. One trap gives
# back both; a signal exits, so the EXIT trap runs once and the run stops.
. "$(dirname "$0")/lock.sh"
cleanup() {
  docker rm -f "$name" "$name-s3" >/dev/null 2>&1 || true
  e2e_unlock
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
e2e_lock "e2e.sh $(git rev-parse --abbrev-ref HEAD 2>/dev/null || pwd)"

# The lock means no other e2e.sh runs, so a ushabti-e2e container left now
# belongs to a run that was killed past its trap (kill -9).
left=$(docker ps -a --format '{{.Names}}' | grep '^ushabti-e2e-' || true)
[ -z "$left" ] || { echo "e2e: removing $(echo $left)"; docker rm -f $left >/dev/null; }

db=$(free)
s3=$(free)
port=$(free)
docker run -d --rm --name "$name" \
  -e POSTGRES_USER=ushabti -e POSTGRES_PASSWORD=ushabti -e POSTGRES_DB=ushabti \
  -p "127.0.0.1:$db:5432" postgres:18 >/dev/null
# The browser PUTs straight to the store, so it answers a preflight for the
# test server's origin only.
docker run -d --rm --name "$name-s3" \
  -e RUSTFS_ACCESS_KEY=ushabti -e RUSTFS_SECRET_KEY=ushabti-secret \
  -e RUSTFS_CORS_ALLOWED_ORIGINS="http://localhost:$port" -e RUSTFS_OBS_LOG_DIRECTORY= \
  -p "127.0.0.1:$s3:9000" rustfs/rustfs:1.0.1 >/dev/null

# Over TCP: on first boot the image runs a server on the socket alone while it
# sets up, then restarts it, and a socket check passes during that window.
i=0
until docker exec "$name" pg_isready -h 127.0.0.1 -U ushabti -d ushabti >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "e2e: Postgres did not start"; exit 1; }
  sleep 1
done

export DATABASE_URL="postgres://ushabti:ushabti@localhost:$db/ushabti"
export S3_ENDPOINT="http://localhost:$s3" S3_REGION=us-east-1 S3_BUCKET=ushabti \
  S3_ACCESS_KEY=ushabti S3_SECRET_KEY=ushabti-secret S3_FORCE_PATH_STYLE=true
[ -n "${SKIP_BUILD:-}" ] || npm run build
npm run db:migrate
# Four workers: 17 minutes became 5 on 2026-10-07. Arguments override it.
nice -n 10 env CI=1 PORT=$port npm run test:e2e -- --workers=4 "$@"
