#!/usr/bin/env bash
# Turns the DICTSAMPLE lines (ADR-030 Decision 0) into the two numbers that
# gate the rest of that ADR: the effective ECDICT miss rate (②) and the shape
# of drag-selected phrases (④).
#
# Usage:
#   kubectl -n enx logs deploy/enx-api --since=336h | scripts/dictsample-report.sh
#   scripts/dictsample-report.sh < saved.log
#
# It deliberately prints the raw miss list too: the headline rate is not the
# decision input -- the EFFECTIVE miss rate is, and telling a real miss from a
# proper noun, a typo or OCR noise is a judgement call that has to be made by
# reading the words.
set -euo pipefail

sample=$(grep -o 'DICTSAMPLE .*' || true)
if [[ -z "$sample" ]]; then
	echo "no DICTSAMPLE lines on stdin -- is ecdict.sampling enabled?" >&2
	exit 1
fi

words=$(grep 'kind=word' <<<"$sample" || true)
phrases=$(grep 'kind=phrase' <<<"$sample" || true)

total_words=$(grep -c . <<<"$words" || echo 0)
local_hits=$(grep -c 'src=local' <<<"$words" || echo 0)
ecdict_hits=$(grep -c 'src=ecdict' <<<"$words" || echo 0)
misses=$(grep -c 'src=none' <<<"$words" || echo 0)

echo "=== ② word lookups ==="
printf 'total          %s\n' "$total_words"
printf 'local (words)  %s\n' "$local_hits"
printf 'ECDICT         %s\n' "$ecdict_hits"
printf 'MISS           %s\n' "$misses"
if (( total_words > 0 )); then
	printf 'raw miss rate  %.2f%%\n' "$(bc -l <<<"100 * $misses / $total_words")"
fi
echo
echo "--- distinct missed words, by frequency ---"
echo "(classify these by hand: real word / proper noun / typo / OCR noise."
echo " the EFFECTIVE miss rate excludes the last three -- that is the number"
echo " ADR-030 Decision 0 ② thresholds are written against.)"
grep 'src=none' <<<"$words" \
	| sed 's/.*text="\(.*\)"$/\1/' \
	| sort | uniq -c | sort -rn

echo
echo "=== ④ drag-selected phrases ==="
total_phrases=$(grep -c . <<<"$phrases" || echo 0)
printf 'total          %s\n' "$total_phrases"
echo
echo "--- word-count distribution ---"
echo "(Decision 8 caps the probe at 5 words; check how much of the real"
echo " traffic that covers, rather than trusting the ECDICT-side 98.6%.)"
grep -o 'wc=[0-9]*' <<<"$phrases" | cut -d= -f2 | sort -n | uniq -c \
	| awk '{printf "%2s words  %6s\n", $2, $1}'
echo
echo "--- distinct phrases, by frequency ---"
echo "(feed these to the ECDICT/Wiktionary cross-match to get the ④ hit rate)"
grep 'kind=phrase' <<<"$sample" \
	| sed 's/.*text="\(.*\)"$/\1/' \
	| sort | uniq -c | sort -rn
