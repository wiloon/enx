#!/usr/bin/env bash
# Runs the root Taskfile's ci:* tasks whose workflow path filter matches the
# files changed between BASE and HEAD (usage: ci-changed.sh [BASE], default
# origin/main). `task ci:changed BASE=<ref>` calls it.
#
# Only committed changes count: the diff is `git diff --name-only BASE...HEAD`,
# so uncommitted and untracked files are ignored. It does not fetch; run
# `git fetch origin main` first when BASE is origin/main.
#
# The path lists are read from each workflow's on.pull_request.paths when this
# runs; only the workflow-to-task mapping below is kept here. Supported filter
# syntax is what the workflows use today: exact paths and `dir/**`, as
# single-quoted list items. Anything else fails instead of selecting nothing.
#
# CI_TASK_CMD overrides the `task` command used to run a selected task (the
# selection tests stub it). Needs git, bash and awk; no yq.
set -euo pipefail

# "task workflow" pairs, in the order the tasks run.
MAPPING=(
  "ci:api enx-api-ci.yml"
  "ci:ui enx-ui-ci.yml"
  "ci:chrome enx-chrome-ci.yml"
  "ci:copied-files copied-files.yml"
)

die() {
  echo "ci-changed: $*" >&2
  exit 1
}

cd "$(dirname "$0")/../.."

base="${1:-origin/main}"
task_cmd="${CI_TASK_CMD:-task}"

base_id=$(git rev-parse --verify --quiet "${base}^{commit}") ||
  die "cannot resolve BASE '$base'. Fetch it first (git fetch origin main) or pass an existing ref."
head_id=$(git rev-parse --verify HEAD)
merge_base=$(git merge-base "$base_id" "$head_id") ||
  die "no merge-base between BASE '$base' and HEAD. Rebase or pick a related BASE."

echo "BASE:       $base ($base_id)"
echo "HEAD:       $head_id"
echo "merge-base: $merge_base"

changed=()
while IFS= read -r -d '' path; do
  changed+=("$path")
done < <(git diff --name-only -z "$base_id...$head_id")

# Prints the on.pull_request.paths patterns of a workflow, one per line.
read_filters() {
  local file=$1
  awk -v file="$file" '
    function fail(msg) { print "ci-changed: " file ": " msg > "/dev/stderr"; bad = 1; exit 1 }
    /^on:[ \t]*$/ { in_on = 1; next }
    in_on && /^[^ \t#]/ { in_on = 0 }
    in_on && /^  [a-z_]+:/ { in_pr = ($0 ~ /^  pull_request:[ \t]*$/); in_paths = 0; if (in_pr) seen_pr = 1; next }
    in_pr && /^    paths-ignore:/ { fail("paths-ignore is not supported") }
    in_pr && /^    paths:[ \t]*$/ { in_paths = 1; seen_paths = 1; next }
    in_pr && /^    [a-z_-]+:/ { in_paths = 0; next }
    in_paths && /^[ \t]*(#.*)?$/ { next }
    in_paths {
      if ($0 !~ /^      - \047[^\047]+\047[ \t]*$/) fail("unsupported paths entry: " $0)
      pat = $0
      sub(/^      - \047/, "", pat)
      sub(/\047[ \t]*$/, "", pat)
      stripped = pat
      sub(/\/\*\*$/, "", stripped)
      if (stripped ~ /[*?\[\]!{}]/ || stripped == "") fail("unsupported path pattern: " pat)
      print pat
    }
    END {
      if (bad) exit 1
      if (!seen_pr) { print "ci-changed: " file ": no on.pull_request block" > "/dev/stderr"; exit 1 }
      if (!seen_paths) { print "ci-changed: " file ": no on.pull_request.paths filter" > "/dev/stderr"; exit 1 }
    }
  ' "$file"
}

selected=()
for entry in "${MAPPING[@]}"; do
  task=${entry%% *}
  workflow=.github/workflows/${entry#* }
  [ -f "$workflow" ] || die "workflow $workflow not found"
  filters=$(read_filters "$workflow") || exit 1
  [ -n "$filters" ] || die "$workflow: on.pull_request.paths is empty"

  match=""
  for path in "${changed[@]}"; do
    while IFS= read -r pattern; do
      if [[ $pattern == */\*\* ]]; then
        [[ $path == "${pattern%\*\*}"* ]] || continue
      else
        [[ $path == "$pattern" ]] || continue
      fi
      match="$path (filter '$pattern')"
      break 2
    done <<<"$filters"
  done
  if [ -n "$match" ]; then
    echo "select $task: $match"
    selected+=("$task")
  fi
done

if [ ${#selected[@]} -eq 0 ]; then
  echo "No ci tasks selected: no changed path matches a workflow filter."
  exit 0
fi

for task in "${selected[@]}"; do
  echo "==> $task"
  $task_cmd "$task"
done
