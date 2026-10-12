#!/bin/sh
# The tag of the release (USH-311): what CONTRIBUTING.md, "Making a release",
# does by hand. release.yml refuses a tag that disagrees with package.json or
# with the changelog, so all three move in the one commit the tag names.
set -eu

V="${SETMAAT_RELEASE_VERSION:?SETMAAT_RELEASE_VERSION is not set}"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "tag.sh: the checkout is on $branch, not main. Nothing was done." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "tag.sh: a tracked file has a change. Nothing was done." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
# A non-empty line between "## Unreleased" and the next "## " heading.
entries=$(awk '/^## /{inside=($0=="## Unreleased"); next} inside && NF' CHANGELOG.md)
if [ -z "$entries" ]; then
  echo "tag.sh: \"## Unreleased\" in CHANGELOG.md has no entry. Nothing was done." >&2
  exit 1
fi
echo "tag.sh: main is clean and Unreleased has entries"

today=$(date +%F)
awk -v heading="## $V — $today" '
  added == 1 { if (NF) print ""; added = 2 }
  { print }
  $0 == "## Unreleased" && !added { print ""; print heading; added = 1 }
' CHANGELOG.md >CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md
echo "tag.sh: CHANGELOG.md has ## $V — $today"

npm version "$V" --no-git-tag-version >/dev/null
echo "tag.sh: package.json and package-lock.json are at $V"

git add CHANGELOG.md package.json package-lock.json
git commit -q -m "Release $V"
git tag -a "v$V" -m "v$V"
echo "tag.sh: committed Release $V and tagged v$V"

# One push for both, so main never names a release whose tag is missing.
git push -q --atomic origin main "v$V"
echo "tag.sh: pushed main and v$V"
