#!/bin/sh
# Starts the shipped server alone, as the image does, and fails unless it
# answers /api/health with 200 (USH-443).
#
# The tests serve `.next/standalone/server.js` from inside the repo, so a
# module the build's trace missed is found in the repo's own `node_modules`
# and nothing fails. The image has no such folder: a missing
# `outputFileTracingIncludes` entry builds, starts, and dies on the first line.
# So this copies what the Dockerfile's runner stage copies to a folder outside
# the repo, where Node can find nothing the trace left out, and runs the
# migration and the server from there, against DATABASE_URL.
#
# It migrates the database as production does, so a caller needs no second
# `npm run db:migrate`. Run it from the root of a checkout after `npm run build`.
set -eu

[ -f .next/standalone/server.js ] || { echo "standalone-check: no .next/standalone/server.js. Run npm run build first." >&2; exit 1; }
: "${DATABASE_URL:?standalone-check: DATABASE_URL is not set}"

port="${STANDALONE_PORT:-$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})")}"
dir=$(mktemp -d "${TMPDIR:-/tmp}/ushabti-standalone.XXXXXX")
pid=""
finish() {
  [ -z "$pid" ] || kill "$pid" 2>/dev/null || true
  [ -z "$pid" ] || wait "$pid" 2>/dev/null || true
  rm -rf "$dir"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# The same three folders as the runner stage of the Dockerfile.
cp -R .next/standalone/. "$dir/"
mkdir -p "$dir/.next"
rm -rf "$dir/.next/static"
cp -R .next/static "$dir/.next/static"
if [ -d public ]; then cp -R public "$dir/public"; fi

cd "$dir"
echo "standalone-check: migrating from $dir"
node scripts/migrate.mjs

NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 node server.js >server.log 2>&1 &
pid=$!

i=0
while :; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "standalone-check: the server stopped before it answered. Its log:" >&2
    cat server.log >&2
    pid=""
    exit 1
  fi
  code=$(node -e "fetch('http://127.0.0.1:$port/api/health').then(r=>process.stdout.write(String(r.status)),()=>process.stdout.write('0'))")
  [ "$code" = "200" ] && break
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "standalone-check: /api/health answered $code after 60 s. The server's log:" >&2
    cat server.log >&2
    exit 1
  fi
  sleep 1
done
echo "standalone-check: the server outside the repo answers /api/health with 200"
