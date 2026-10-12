#!/bin/sh
# The confirm of the release (USH-311). It prints the SQL of every migration
# added since the previous release, so the owner reads it before it reaches
# production: a rollback swaps only the image and cannot undo a migration.
# Nothing printed means nothing to ask, and the release goes on.
set -eu

prev="${SETMAAT_RELEASE_PREVIOUS:-}"
if [ -z "$prev" ]; then
  echo "migrations.sh: SETMAAT_RELEASE_PREVIOUS is empty, so the new migrations cannot be found." >&2
  exit 1
fi

# Into a variable first: sh has no pipefail, and a failed diff in a pipe
# would print nothing, which reads as "no migration".
added=$(git diff --name-only --diff-filter=A "$prev" HEAD -- 'drizzle/*.sql')
[ -z "$added" ] && exit 0
printf '%s\n' "$added" | sort | while IFS= read -r file; do
  echo "### $file"
  echo
  echo '```sql'
  cat "$file"
  echo '```'
  echo
done
