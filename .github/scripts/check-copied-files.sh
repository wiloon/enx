#!/usr/bin/env bash
# enx-ui can't import enx-chrome's code (its image builds from enx-ui/ alone),
# so a few enx-chrome modules are copied into enx-ui. Fails when a copy and
# its original differ anywhere past the header comment that names the twin.
set -euo pipefail

cd "$(dirname "$0")/../.."

# "original copy" pairs, relative to the repo root.
PAIRS=(
  "enx-chrome/src/lib/pronunciation.ts enx-ui/src/lib/pronunciation.ts"
  "enx-chrome/src/lib/phonetic.ts enx-ui/src/lib/phonetic.ts"
)

# Drops the header: every line up to the one that says "change both
# together.", then the blank or bare "//" lines after it.
strip_header() {
  awk '
    !done && /change both together\./ { done = 1; skipping = 1; next }
    !done { next }
    skipping && /^(\/\/)?[[:space:]]*$/ { next }
    { skipping = 0; print }
  ' "$1"
}

status=0
for pair in "${PAIRS[@]}"; do
  read -r original copy <<<"$pair"
  for f in "$original" "$copy"; do
    if ! grep -q 'change both together\.' "$f"; then
      echo "::error file=$f::header must name its twin and say \"change both together.\""
      status=1
    fi
  done
  if ! diff -u --label "$original" --label "$copy" \
    <(strip_header "$original") <(strip_header "$copy"); then
    echo "::error file=$copy::differs from $original; change both together"
    status=1
  fi
done
exit $status
