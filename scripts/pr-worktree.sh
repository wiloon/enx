#!/bin/sh
# Usage: scripts/pr-worktree.sh <PR number>
# Prints the path of a worktree that has the PR's head checked out, creating
# it when needed. Run from any checkout of the repo; needs no GitHub token
# (the repo is public, so `git fetch origin pull/N/head` works).
#
# - The PR's branch already checked out in some worktree: reuse that one.
# - Otherwise: .claude/worktrees/pr-<N> in the main checkout, on the PR's
#   branch (tracking origin, so commits can be pushed back to the PR), or on a
#   detached HEAD when the branch isn't in this repo (a fork's PR).
# - A merged PR (its head is on origin/main): no worktree; says to use main.
# - A reused worktree that is clean and behind the PR fast-forwards to it.
# - New worktrees get the gitignored env files listed in .worktreeinclude,
#   copied from the main checkout.
# Progress goes to stderr; only the path goes to stdout.
set -eu

pr="${1:-}"
case "$pr" in
  ''|*[!0-9]*|0*) echo 'PR must be a positive integer (for example PR=718)' >&2; exit 2 ;;
esac

main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
cd "$main"

git fetch -q origin "pull/$pr/head" || { echo "PR #$pr not found on origin" >&2; exit 1; }
sha="$(git rev-parse FETCH_HEAD)"

# The PR's branch: the origin branch whose tip is the PR head.
branch="$(git ls-remote --heads origin | awk -v s="$sha" '$1 == s { sub("refs/heads/", "", $2); print $2; exit }')"

# A merged PR's branch is usually deleted; its code is on main now.
if [ -z "$branch" ]; then
  git fetch -q origin main
  if git merge-base --is-ancestor "$sha" origin/main; then
    echo "PR #$pr is already merged into main. Verify it on main instead:" >&2
    echo "  git -C \"$main\" pull --ff-only && task -d \"$main\" dev:verify" >&2
    exit 1
  fi
fi

wt=""
if [ -n "$branch" ]; then
  git fetch -q origin "$branch"
  wt="$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '
    /^worktree / { p = substr($0, 10) }
    $0 == "branch " b { print p; exit }')"
fi

if [ -n "$wt" ]; then
  echo "Reusing $wt ($branch)" >&2
  if [ -z "$(git -C "$wt" status --porcelain)" ] &&
    git -C "$wt" merge-base --is-ancestor HEAD "$sha"; then
    git -C "$wt" merge -q --ff-only "$sha"
  else
    echo "  Not updated: it has local changes or commits not in the PR." >&2
  fi
else
  wt="$main/.claude/worktrees/pr-$pr"
  if [ -e "$wt" ]; then
    echo "$wt exists but isn't on the PR's branch; remove it or check it out by hand" >&2
    exit 1
  fi
  if [ -n "$branch" ]; then
    if git show-ref -q --verify "refs/heads/$branch"; then
      git worktree add -q "$wt" "$branch" >&2
    else
      git worktree add -q --track -b "$branch" "$wt" "origin/$branch" >&2
    fi
    echo "Created $wt ($branch)" >&2
  else
    git worktree add -q --detach "$wt" "$sha" >&2
    echo "Created $wt (detached at the PR head: its branch isn't on origin, e.g. a fork's PR)" >&2
  fi
  if [ -f .worktreeinclude ]; then
    grep -v '^[[:space:]]*\(#\|$\)' .worktreeinclude | while IFS= read -r f; do
      if [ -f "$f" ] && [ ! -e "$wt/$f" ]; then
        cp "$f" "$wt/$f"
      fi
    done
  fi
fi

echo "$wt"
