#!/usr/bin/env bash
# Tests for ci-changed.sh, driven through its dry-run command in throwaway
# repositories: `bash .github/scripts/__tests__/ci-changed.test.sh`.
#
# The selector reads each workflow's own path filter, so every case writes the
# workflow it needs. The fixtures live in the system temp dir; a killed run
# leaves nothing inside this worktree (#481).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)

failures=0
name=""

fail() {
  printf 'not ok - %s: %s\n' "$name" "$1" >&2
  failures=$((failures + 1))
}

pass() {
  printf 'ok - %s\n' "$name"
}

# new_repo starts a repository holding the selector and one workflow per task,
# each selecting docs/**, and commits it. Sets $repo.
new_repo() {
  repo=$(mktemp -d "${TMPDIR:-/tmp}/ci-changed-test.XXXXXX")
  trap 'rm -rf "$repo"' EXIT
  mkdir -p "$repo/.github/scripts" "$repo/.github/workflows"
  cp "$root/.github/scripts/ci-changed.sh" "$repo/.github/scripts/"
  for workflow in ci-scripts enx-api-ci enx-ui-ci enx-chrome-ci copied-files; do
    write_filter "$workflow" 'docs/**'
  done
  git -C "$repo" init -q
  git -C "$repo" add .
  git -C "$repo" -c user.name=Test -c user.email=test@example.com \
    commit -qm fixture
}

# write_filter replaces one workflow with a pull_request-only filter.
write_filter() {
  printf "on:\n  pull_request:\n    paths:\n      - '%s'\n" "$2" \
    >"$repo/.github/workflows/$1.yml"
}

# run_selector runs the selector against HEAD, leaving its status in $status
# and its streams in $out and $err.
run_selector() {
  local errfile="$repo/stderr.txt"
  set +e
  out=$(cd "$repo" && bash .github/scripts/ci-changed.sh HEAD 2>"$errfile")
  status=$?
  set -e
  err=$(<"$errfile")
}

new_repo

name="rejects unsupported operators and escapes"
before=$failures
for pattern in 'docs/v+.md' 'docs/v\+.md' 'docs/v?.md' 'docs/[ab].md'; do
  write_filter enx-api-ci "$pattern"
  run_selector
  if [ "$status" -eq 0 ]; then
    fail "'$pattern' was accepted"
  elif [[ $err != *"unsupported path pattern"* ]]; then
    fail "stderr for '$pattern' does not say why: $err"
  fi
done
if [ "$failures" -eq "$before" ]; then pass; fi

# #481: a top-level key after on:'s pull_request block must end the paths
# list, not be read as another entry, in a workflow with no push block.
name="a top-level permissions key ends the paths list"
printf "on:\n  pull_request:\n    paths:\n      - 'docs/**'\npermissions:\n  contents: read\n" \
  >"$repo/.github/workflows/enx-api-ci.yml"
run_selector
if [ "$status" -ne 0 ]; then
  fail "exited $status: $err"
elif [[ $out != *"No ci tasks selected"* ]]; then
  fail "did not select from an empty diff: $out"
else
  pass
fi

if [ "$failures" -ne 0 ]; then
  printf '%d test(s) failed\n' "$failures" >&2
  exit 1
fi
