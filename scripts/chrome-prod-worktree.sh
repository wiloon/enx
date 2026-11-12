#!/bin/sh
# Usage: scripts/chrome-prod-worktree.sh [REV]
# Prints the path of a worktree with REV (default origin/main, fetched first)
# checked out on a detached HEAD, for building the production extension from
# a committed tree: no local edits, no gitignored .env files.
#
# The worktree is .claude/worktrees/chrome-prod in the main checkout and is
# reused across runs, so its node_modules survives. A reused worktree with
# local changes is refused rather than overwritten.
# Progress goes to stderr; only the path goes to stdout.
set -eu

rev="${1:-origin/main}"

main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
cd "$main"

git fetch -q origin main
sha="$(git rev-parse --verify -q "$rev^{commit}")" || {
  echo "Unknown revision: $rev" >&2
  exit 1
}

wt="$main/.claude/worktrees/chrome-prod"
if [ -e "$wt" ]; then
  if [ -n "$(git -C "$wt" status --porcelain --untracked-files=no)" ]; then
    echo "$wt has local changes; clean it up or remove it first" >&2
    exit 1
  fi
  git -C "$wt" checkout -q --detach "$sha" >&2
else
  git worktree add -q --detach "$wt" "$sha" >&2
fi

echo "Building from $(git -C "$wt" log -1 --format='%h %s')" >&2
echo "$wt"
