// Which review stage a word on the Word List is in, and the colour the
// extension underlines that stage with (ADR-011 E1), so a word's dot here
// matches its underline on the page.
//
// A copy of enx-chrome/src/lib/wordHighlight.ts (reviewBucket,
// HIGHLIGHT_BUCKET_COLORS): the two packages share no code. The test in
// __tests__/reviewBucket.test.ts compares both copies, so changing one
// without the other turns it red.
//
// Fewer lookups = an earlier stage = a darker colour; a word looked up many
// times is close to known, so its colour is faint.

export const REVIEW_BUCKET_COLORS: readonly string[] = [
  'oklch(0.45 0.13 305)', // 1 - very new, most prominent
  'oklch(0.53 0.13 305)', // 2
  'oklch(0.61 0.12 305)', // 3
  'oklch(0.69 0.1 305)', // 4
  'oklch(0.77 0.08 305)', // 5 - nearly known, faintest
]

// 1 = just started, 5 = nearly known; null for a known word or one never
// looked up, which the extension doesn't underline either.
export function reviewBucket(word: {
  queryCount: number
  known: boolean
}): number | null {
  if (word.known || word.queryCount === 0) return null
  const count = word.queryCount
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  if (count <= 18) return 4
  return REVIEW_BUCKET_COLORS.length
}
